alter table public.profiles
  add column if not exists phone_number text
    check (phone_number is null or length(trim(phone_number)) <= 32);

grant update (display_name, phone_number) on public.profiles to authenticated;
