-- Push trigger now targets the Mumbai project (ap-south-1) after the region move.
create or replace function app.push_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.employee_id is null then return new; end if;
  begin
    perform net.http_post(
      url := 'https://mijyuhjmernciujisrwm.supabase.co/functions/v1/send-push',
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    null;   -- push is best effort; the in-app notification is already stored
  end;
  return new;
end $$;
