-- FinanceLab — Supabase schema
-- Run this in the Supabase SQL editor to create the required tables.

create table if not exists progress (
  id               uuid        primary key default gen_random_uuid(),
  session_id       text        not null unique,
  chapter_id       text        not null default '',
  curriculum       text        not null default 'harrison',
  completed        boolean     default false,
  quiz_scores      integer[]   default '{}',
  weak_spots       text[]      default '{}',
  difficulty_rating text,
  last_studied     timestamptz,
  session_state    jsonb
);

create table if not exists library (
  id               uuid        primary key default gen_random_uuid(),
  concept          text        not null,
  definition       text        not null,
  source           text,
  source_session_id text,
  is_manual        boolean     default false,
  created_at       timestamptz default now()
);

create table if not exists srs_schedule (
  id               uuid        primary key default gen_random_uuid(),
  session_id       text        not null unique,
  chapter_id       text        not null default '',
  curriculum       text        not null default 'harrison',
  next_review_date date        not null,
  interval_days    integer     default 3,
  ease_factor      float       default 2.5,
  review_count     integer     default 0,
  last_score       integer,
  weak_spots       text[]      default '{}'
);
