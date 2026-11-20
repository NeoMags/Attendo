-- Attendo 006: pin search_path on trigger helpers flagged by the Supabase security advisor.
alter function app.touch_updated_at() set search_path = '';
alter function app.block_mutation() set search_path = '';
alter function app.validate_timezone() set search_path = '';
alter function app.next_login_phone() set search_path = '';
alter function app.validate_setting() set search_path = '';
alter function app.attendance_guard() set search_path = '';
