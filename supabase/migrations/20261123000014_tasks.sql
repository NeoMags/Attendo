-- Attendo 014: tasks and subtasks (one level), assignee per task/subtask, submit -> approve/rework workflow.
-- Clients only read; every write goes through the RPCs below so the rules cannot be bypassed.
create type public.task_status as enum ('todo', 'in_progress', 'submitted', 'rework', 'approved', 'cancelled');

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  parent_id uuid,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  assignee_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  due_date date,
  status public.task_status not null default 'todo',
  created_by uuid not null,
  submit_note text check (submit_note is null or length(submit_note) <= 500),
  submitted_at timestamptz,
  reviewed_by uuid, reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, company_id),
  foreign key (assignee_id, company_id) references public.employees (id, company_id),
  foreign key (parent_id, company_id) references public.tasks (id, company_id) on delete cascade,
  check (parent_id is distinct from id)
);
create index tasks_company_status on public.tasks (company_id, status, due_date);
create index tasks_assignee on public.tasks (assignee_id, status);
create index tasks_parent on public.tasks (parent_id);

create trigger tasks_touch before update on public.tasks for each row execute function app.touch_updated_at();
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function app.audit_row();

-- parents of tasks assigned to me (lets an employee see the parent title of their own subtask; SECURITY DEFINER avoids policy recursion)
create function app.my_task_parent_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select t.parent_id from public.tasks t where t.assignee_id = (select app.my_employee_id()) and t.parent_id is not null $$;

-- true when the caller is an admin of the task's company, or a manager who created it / manages its assignee
create function app.can_manage_task(p_company uuid, p_assignee uuid, p_created_by uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select app.is_super_admin())
    or (p_company = (select app.my_company_id()) and (select app.my_role()) = 'company_admin')
    or (p_company = (select app.my_company_id()) and (select app.my_role()) = 'manager'
        and (p_created_by = (select auth.uid()) or p_assignee in (select app.managed_employee_ids()))) $$;

alter table public.tasks enable row level security;
create policy tasks_select on public.tasks for select to authenticated using (
  app.can_manage_task(company_id, assignee_id, created_by)
  or assignee_id = (select app.my_employee_id())
  or id in (select app.my_task_parent_ids())
);
grant select on public.tasks to authenticated;   -- writes only through the RPCs

create function app.notify_task(p_company uuid, p_employee uuid, p_title text, p_body text, p_task uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (company_id, employee_id, kind, title, body, data)
  values (p_company, p_employee, 'task', p_title, p_body, jsonb_build_object('task_id', p_task)) $$;

-- ---------------------------------------------------------------- RPCs
create function public.create_task(p_company uuid, p_title text, p_description text default null, p_assignee uuid default null,
                                   p_priority text default 'normal', p_due date default null, p_parent uuid default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare v_role public.app_role := (select app.my_role()); v_title text := btrim(p_title); par public.tasks; r public.tasks;
begin
  if v_role is null or v_role not in ('super_admin', 'company_admin', 'manager') then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_role <> 'super_admin' and p_company is distinct from (select app.my_company_id()) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_title is null or length(v_title) = 0 or length(v_title) > 200 then raise exception 'INVALID_TITLE'; end if;
  if p_priority not in ('low', 'normal', 'high') then raise exception 'INVALID_PRIORITY'; end if;
  if p_parent is not null then
    select * into par from public.tasks where id = p_parent and company_id = p_company for update;
    if not found then raise exception 'TASK_NOT_FOUND'; end if;
    if par.parent_id is not null then raise exception 'SUBTASK_DEPTH'; end if;          -- subtasks cannot have subtasks
    if par.status in ('approved', 'cancelled') then raise exception 'INVALID_STATE'; end if;
    if not app.can_manage_task(par.company_id, par.assignee_id, par.created_by) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  end if;
  if v_role = 'manager' and (p_assignee is null or p_assignee not in (select app.managed_employee_ids())) and p_assignee is distinct from (select app.my_employee_id())
    then raise exception 'ASSIGNEE_NOT_ALLOWED' using errcode = '42501'; end if;
  if p_assignee is not null and not exists (select 1 from public.employees e where e.id = p_assignee and e.company_id = p_company and e.is_active)
    then raise exception 'ASSIGNEE_NOT_FOUND'; end if;
  insert into public.tasks (company_id, parent_id, title, description, assignee_id, priority, due_date, created_by)
  values (p_company, p_parent, v_title, nullif(btrim(p_description), ''), p_assignee, p_priority, p_due, (select auth.uid()))
  returning * into r;
  if r.assignee_id is not null and r.assignee_id is distinct from (select app.my_employee_id()) then
    perform app.notify_task(r.company_id, r.assignee_id, 'New task assigned', r.title, r.id);
  end if;
  return r;
end $$;

-- p_clear_due = true removes the due date; null arguments keep the current value.
create function public.update_task(p_id uuid, p_title text default null, p_description text default null, p_assignee uuid default null,
                                   p_priority text default null, p_due date default null, p_clear_due boolean default false)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare r public.tasks; v_role public.app_role := (select app.my_role()); v_title text := nullif(btrim(p_title), '');
begin
  select * into r from public.tasks where id = p_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not app.can_manage_task(r.company_id, r.assignee_id, r.created_by) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.status in ('approved', 'cancelled') then raise exception 'INVALID_STATE'; end if;
  if p_title is not null and (v_title is null or length(v_title) > 200) then raise exception 'INVALID_TITLE'; end if;
  if p_priority is not null and p_priority not in ('low', 'normal', 'high') then raise exception 'INVALID_PRIORITY'; end if;
  if p_assignee is not null then
    if not exists (select 1 from public.employees e where e.id = p_assignee and e.company_id = r.company_id and e.is_active) then raise exception 'ASSIGNEE_NOT_FOUND'; end if;
    if v_role = 'manager' and p_assignee not in (select app.managed_employee_ids()) and p_assignee is distinct from (select app.my_employee_id())
      then raise exception 'ASSIGNEE_NOT_ALLOWED' using errcode = '42501'; end if;
  end if;
  update public.tasks set title = coalesce(v_title, title), description = case when p_description is null then description else nullif(btrim(p_description), '') end,
    assignee_id = coalesce(p_assignee, assignee_id), priority = coalesce(p_priority, priority),
    due_date = case when p_clear_due then null else coalesce(p_due, due_date) end,
    -- a reassigned task starts over for the new person
    status = case when p_assignee is not null and p_assignee is distinct from r.assignee_id then 'todo'::public.task_status else status end
    where id = r.id returning * into r;
  if p_assignee is not null and r.assignee_id is distinct from (select app.my_employee_id()) then
    perform app.notify_task(r.company_id, r.assignee_id, 'Task assigned to you', r.title, r.id);
  end if;
  return r;
end $$;

create function public.cancel_task(p_id uuid) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare r public.tasks;
begin
  select * into r from public.tasks where id = p_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not app.can_manage_task(r.company_id, r.assignee_id, r.created_by) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.status in ('approved', 'cancelled') then raise exception 'INVALID_STATE'; end if;
  update public.tasks set status = 'cancelled' where id = r.id or parent_id = r.id and status not in ('approved', 'cancelled');
  select * into r from public.tasks where id = p_id;
  return r;
end $$;

-- The assignee moves their own task: todo/rework -> in_progress, or -> submitted for review.
create function public.set_task_progress(p_id uuid, p_status text, p_note text default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare r public.tasks; v_emp uuid := (select app.my_employee_id()); v_note text := nullif(btrim(p_note), ''); m record; v_sent boolean := false;
begin
  select * into r from public.tasks where id = p_id for update;
  if not found or v_emp is null or r.assignee_id is distinct from v_emp then raise exception 'TASK_NOT_FOUND'; end if;
  if p_status not in ('in_progress', 'submitted') then raise exception 'INVALID_STATUS'; end if;
  if r.status not in ('todo', 'in_progress', 'rework') then raise exception 'INVALID_STATE'; end if;
  if p_status = 'in_progress' and r.status = 'in_progress' then raise exception 'INVALID_STATE'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;
  if p_status = 'submitted' and exists (select 1 from public.tasks s where s.parent_id = r.id and s.status in ('todo', 'in_progress', 'rework'))
    then raise exception 'SUBTASKS_OPEN'; end if;
  update public.tasks set status = p_status::public.task_status,
    submit_note = case when p_status = 'submitted' then v_note else submit_note end,
    submitted_at = case when p_status = 'submitted' then now() else submitted_at end
    where id = r.id returning * into r;
  if r.status = 'submitted' then
    for m in select ma.manager_employee_id from public.manager_assignments ma where ma.employee_id = r.assignee_id loop
      perform app.notify_task(r.company_id, m.manager_employee_id, 'Task submitted for approval', r.title, r.id);
      v_sent := true;
    end loop;
    perform app.notify_task(r.company_id, null, 'Task submitted for approval', r.title, r.id);   -- admins always see it too
  end if;
  return r;
end $$;

create function public.review_task(p_id uuid, p_approve boolean, p_note text default null)
returns public.tasks language plpgsql security definer set search_path = '' as $$
declare r public.tasks; v_note text := nullif(btrim(p_note), '');
begin
  select * into r from public.tasks where id = p_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if not app.can_manage_task(r.company_id, r.assignee_id, r.created_by) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if r.assignee_id is not null and r.assignee_id = (select app.my_employee_id()) then raise exception 'SELF_REVIEW_NOT_ALLOWED' using errcode = '42501'; end if;
  if p_approve is null then raise exception 'INVALID_DECISION'; end if;
  if r.status <> 'submitted' then raise exception 'INVALID_STATE'; end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then raise exception 'NOTE_REQUIRED'; end if;
  if v_note is not null and length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;
  if p_approve and exists (select 1 from public.tasks s where s.parent_id = r.id and s.status not in ('approved', 'cancelled')) then raise exception 'SUBTASKS_OPEN'; end if;
  update public.tasks set status = case when p_approve then 'approved' else 'rework' end::public.task_status,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = v_note
    where id = r.id returning * into r;
  if r.assignee_id is not null then
    perform app.notify_task(r.company_id, r.assignee_id, case when p_approve then 'Task approved' else 'Task sent back for rework' end, r.title, r.id);
  end if;
  return r;
end $$;

revoke all on function public.create_task(uuid, text, text, uuid, text, date, uuid), public.update_task(uuid, text, text, uuid, text, date, boolean),
  public.cancel_task(uuid), public.set_task_progress(uuid, text, text), public.review_task(uuid, boolean, text) from public, anon;
grant execute on function public.create_task(uuid, text, text, uuid, text, date, uuid), public.update_task(uuid, text, text, uuid, text, date, boolean),
  public.cancel_task(uuid), public.set_task_progress(uuid, text, text), public.review_task(uuid, boolean, text) to authenticated;
