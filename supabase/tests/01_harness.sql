create schema t;
create table t.results (n serial primary key, name text, passed boolean, detail text);
grant usage on schema t to public; grant all on t.results to public; grant all on sequence t.results_n_seq to public;
create function t.ok(cond boolean, name text, detail text default null) returns void language plpgsql as $$
begin insert into t.results(name, passed, detail) values (name, coalesce(cond, false), detail); end $$;
create function t.login(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, true); execute 'set local role authenticated'; end $$;
create function t.service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', true); execute 'set local role service_role'; end $$;
create function t.logout() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
-- runs sql as the current role; passes if it raises an error whose message contains `expect`
create function t.throws(q text, expect text, name text) returns void language plpgsql as $$
declare msg text;
begin
  begin execute q; msg := null;
  exception when others then msg := sqlerrm; end;
  perform t.ok(msg is not null and position(lower(expect) in lower(msg)) > 0, name, coalesce(msg, 'no error raised'));
end $$;
-- runs a DML statement; returns affected row count (RLS-filtered rows count as 0)
create function t.rows(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema t to public;
