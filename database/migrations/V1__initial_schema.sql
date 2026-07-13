-- PostgreSQL production blueprint. The runnable demo uses JSON persistence.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL,
  country text NOT NULL,
  timezone text NOT NULL DEFAULT 'Africa/Addis_Ababa',
  currency char(3) NOT NULL DEFAULT 'ETB',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES properties(id),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  department text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE room_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  name text NOT NULL,
  capacity integer NOT NULL,
  base_rate numeric(12,2) NOT NULL,
  UNIQUE(property_id, name)
);

CREATE TABLE rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  number text NOT NULL,
  floor integer NOT NULL,
  status text NOT NULL DEFAULT 'clean',
  version integer NOT NULL DEFAULT 1,
  UNIQUE(property_id, number)
);

CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  nationality text,
  vip boolean NOT NULL DEFAULT false,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id),
  confirmation_no text UNIQUE NOT NULL,
  guest_id uuid NOT NULL REFERENCES guests(id),
  room_type_id uuid NOT NULL REFERENCES room_types(id),
  room_id uuid REFERENCES rooms(id),
  check_in date NOT NULL,
  check_out date NOT NULL,
  adults integer NOT NULL DEFAULT 1,
  children integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'direct',
  status text NOT NULL DEFAULT 'reserved',
  rate numeric(12,2) NOT NULL,
  deposit numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE folios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id uuid UNIQUE NOT NULL REFERENCES reservations(id),
  status text NOT NULL DEFAULT 'open',
  currency char(3) NOT NULL DEFAULT 'ETB',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE folio_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folio_id uuid NOT NULL REFERENCES folios(id),
  line_type text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id),
  task_type text NOT NULL DEFAULT 'cleaning',
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  assigned_to uuid REFERENCES users(id),
  due_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
