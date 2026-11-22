-- Round 3: tasks and subtasks (RLS visibility, assignment rules, submit/approve workflow, notifications).
do $$
declare ca uuid := t.id('cA'); a1 uuid := t.id('eA1'); a2 uuid := t.id('eA2'); mA uuid := t.id('eMA');
  tk public.tasks; sub public.tasks; sub2 public.tasks; own public.tasks;
begin
  -- ---- create / assign
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.create_task(%L, 'x')$q$, ca), 'FORBIDDEN', 'employee cannot create tasks');
  perform t.logout();

  perform t.login(t.id('uAB'));
  perform t.throws(format($q$select public.create_task(%L, 'x', null, %L)$q$, ca, a1), 'FORBIDDEN', 'other company admin cannot create tasks here');
  perform t.logout();

  perform t.login(t.id('uAA'));
  tk := public.create_task(ca, 'Survey site 12', 'Measure and photograph', a1, 'high', current_date + 3);
  perform t.ok(tk.status = 'todo' and tk.assignee_id = a1 and tk.priority = 'high', 'admin creates and assigns a task');
  perform t.ok(exists (select 1 from public.notifications where employee_id = a1 and kind = 'task' and data ->> 'task_id' = tk.id::text), 'assignee is notified');
  sub := public.create_task(ca, 'Take photos', null, a1, 'normal', null, tk.id);
  sub2 := public.create_task(ca, 'Measure plot', null, a2, 'normal', null, tk.id);
  perform t.ok(sub.parent_id = tk.id and sub2.assignee_id = a2, 'subtasks can be assigned to different people');
  perform t.throws(format($q$select public.create_task(%L, 'deep', null, %L, 'normal', null, %L)$q$, ca, a1, sub.id), 'SUBTASK_DEPTH', 'subtasks cannot nest');
  perform t.throws(format($q$select public.create_task(%L, '   ')$q$, ca), 'INVALID_TITLE', 'blank title rejected');
  perform t.throws(format($q$select public.create_task(%L, 'x', null, %L, 'urgent')$q$, ca, a1), 'INVALID_PRIORITY', 'bad priority rejected');
  perform t.throws(format($q$select public.create_task(%L, 'x', null, %L)$q$, ca, t.id('cB')), 'ASSIGNEE_NOT_FOUND', 'cannot assign across companies');
  perform t.throws(format($q$update public.tasks set status = 'approved' where id = %L$q$, tk.id), 'permission denied', 'clients cannot write tasks directly');
  perform t.logout();

  -- ---- visibility
  perform t.login(t.id('uA1'));
  perform t.ok((select count(*) from public.tasks) = 2, 'employee sees own task and own subtask only');
  perform t.ok(not exists (select 1 from public.tasks where id = sub2.id), 'employee cannot see a colleague''s subtask');
  perform t.logout();
  perform t.login(t.id('uA2'));
  perform t.ok((select count(*) from public.tasks) = 2 and exists (select 1 from public.tasks where id = tk.id), 'employee sees own subtask plus its parent');
  perform t.logout();
  perform t.login(t.id('uAB'));
  perform t.ok((select count(*) from public.tasks) = 0, 'other company sees nothing');
  perform t.logout();
  perform t.login(t.id('uMA'));
  perform t.ok(exists (select 1 from public.tasks where id = tk.id) and not exists (select 1 from public.tasks where id = sub2.id), 'manager sees team tasks only');
  perform t.logout();

  -- ---- manager rules
  perform t.login(t.id('uMA'));
  perform t.throws(format($q$select public.create_task(%L, 'x', null, %L)$q$, ca, a2), 'ASSIGNEE_NOT_ALLOWED', 'manager cannot assign outside their team');
  perform t.throws(format($q$select public.create_task(%L, 'x')$q$, ca), 'ASSIGNEE_NOT_ALLOWED', 'manager must pick an assignee');
  own := public.create_task(ca, 'Team standup notes', null, a1);
  perform t.ok(own.created_by is not null, 'manager assigns to own team member');
  perform t.throws(format($q$select public.update_task(%L, 'hijack')$q$, sub2.id), 'FORBIDDEN', 'manager cannot edit a non-team task');
  perform t.logout();

  -- ---- employee workflow
  perform t.login(t.id('uA2'));
  perform t.throws(format($q$select public.set_task_progress(%L, 'submitted')$q$, tk.id), 'TASK_NOT_FOUND', 'cannot progress a task assigned to someone else');
  perform t.throws(format($q$select public.set_task_progress(%L, 'approved')$q$, sub2.id), 'INVALID_STATUS', 'employee cannot self-approve');
  perform t.ok((public.set_task_progress(sub2.id, 'in_progress')).status = 'in_progress', 'employee starts a subtask');
  perform t.throws(format($q$select public.set_task_progress(%L, 'in_progress')$q$, sub2.id), 'INVALID_STATE', 'already in progress');
  perform t.ok((public.set_task_progress(sub2.id, 'submitted', 'done, photos attached')).status = 'submitted', 'employee submits a subtask');
  perform t.throws(format($q$select public.review_task(%L, true)$q$, sub2.id), 'FORBIDDEN', 'employee cannot review');
  perform t.logout();
  perform t.ok(exists (select 1 from public.notifications where employee_id is null and kind = 'task' and title = 'Task submitted for approval' and data ->> 'task_id' = sub2.id::text), 'admins are notified of a submission');
  perform t.ok(exists (select 1 from public.notifications where employee_id = mA and kind = 'task' and title = 'Task submitted for approval' and data ->> 'task_id' = sub2.id::text) or not exists (select 1 from public.manager_assignments where employee_id = a2), 'assigned manager is notified when one exists');

  -- ---- review
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.review_task(%L, false)$q$, sub2.id), 'NOTE_REQUIRED', 'sending back needs a note');
  perform t.ok((public.review_task(sub2.id, false, 'photos are blurry')).status = 'rework', 'admin sends work back');
  perform t.ok(exists (select 1 from public.notifications where employee_id = a2 and title = 'Task sent back for rework'), 'assignee is told about the rework');
  perform t.throws(format($q$select public.review_task(%L, true)$q$, sub2.id), 'INVALID_STATE', 'only submitted work can be reviewed');
  perform t.logout();
  perform t.login(t.id('uA2'));
  perform t.ok((public.set_task_progress(sub2.id, 'submitted')).status = 'submitted', 'rework can be resubmitted');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.ok((public.review_task(sub2.id, true, null)).status = 'approved', 'admin approves');
  perform t.throws(format($q$select public.update_task(%L, 'late edit')$q$, sub2.id), 'INVALID_STATE', 'approved task is locked');
  perform t.logout();

  -- ---- parent needs finished subtasks
  perform t.login(t.id('uA1'));
  perform t.throws(format($q$select public.set_task_progress(%L, 'submitted')$q$, tk.id), 'SUBTASKS_OPEN', 'parent cannot be submitted while a subtask is open');
  perform public.set_task_progress(sub.id, 'submitted');
  perform t.ok((public.set_task_progress(tk.id, 'submitted')).status = 'submitted', 'parent submits once subtasks are submitted');
  perform t.logout();
  perform t.login(t.id('uAA'));
  perform t.throws(format($q$select public.review_task(%L, true)$q$, tk.id), 'SUBTASKS_OPEN', 'parent cannot be approved before its subtasks');
  perform public.review_task(sub.id, true);
  perform t.ok((public.review_task(tk.id, true)).status = 'approved', 'parent approved after subtasks');
  perform t.logout();

  -- ---- reassign + cancel + self review
  perform t.login(t.id('uAA'));
  own := public.create_task(ca, 'Collect cheque', null, a1);
  own := public.update_task(own.id, null, null, a2);
  perform t.ok(own.assignee_id = a2 and own.status = 'todo', 'admin reassigns a task');
  perform t.ok((public.cancel_task(own.id)).status = 'cancelled', 'admin cancels a task');
  perform t.throws(format($q$select public.cancel_task(%L)$q$, own.id), 'INVALID_STATE', 'cannot cancel twice');
  perform t.logout();
  perform t.login(t.id('uMA'));
  own := public.create_task(ca, 'My own report', null, mA);
  perform public.set_task_progress(own.id, 'submitted');
  perform t.throws(format($q$select public.review_task(%L, true)$q$, own.id), 'SELF_REVIEW_NOT_ALLOWED', 'nobody approves their own task');
  perform t.logout();
end $$;
