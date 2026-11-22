-- Push delivery: every notification for an employee triggers the send-push Edge Function (async, via pg_net).
-- No secret is stored in the database: the function only sends rows that are still undelivered and claims them atomically.
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net unavailable (%); push trigger will no-op', sqlerrm;   -- e.g. plain Postgres test rig
end $$;

create function app.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://ehwlqttwkmbgfttqvtcd.supabase.co/functions/v1/send-push',
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    null;   -- push is best effort; the in-app notification is already stored
  end;
  return new;
end $$;
revoke all on function app.push_notification() from public, anon, authenticated;

create trigger notifications_push after insert on public.notifications
  for each row execute function app.push_notification();
