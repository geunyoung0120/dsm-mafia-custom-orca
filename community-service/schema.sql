CREATE SCHEMA IF NOT EXISTS community;

CREATE TABLE IF NOT EXISTS community.users (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9_-]{2,31}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS community.sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES community.users(id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_session_expiry ON community.sessions(expires_at);
CREATE TABLE IF NOT EXISTS community.skills (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES community.users(id),
  name text NOT NULL CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  latest_version integer NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name)
);
CREATE TABLE IF NOT EXISTS community.versions (
  skill_id uuid NOT NULL REFERENCES community.skills(id),
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  description text NOT NULL CHECK (length(description) <= 500),
  body text NOT NULL CHECK (octet_length(body) BETWEEN 1 AND 65536),
  digest text NOT NULL CHECK (digest ~ '^[a-f0-9]{64}$'),
  supported_agents text[] NOT NULL CHECK (
    cardinality(supported_agents) BETWEEN 1 AND 4 AND
    supported_agents <@ ARRAY['codex','claude','openclaude','grok']::text[]
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(skill_id, version)
);
CREATE TABLE IF NOT EXISTS community.reports (
  skill_id uuid NOT NULL REFERENCES community.skills(id),
  user_id uuid NOT NULL REFERENCES community.users(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(skill_id, user_id)
);
CREATE TABLE IF NOT EXISTS community.rate_limits (
  key text PRIMARY KEY,
  window_start bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS community_rate_limit_expiry ON community.rate_limits(window_start);

CREATE TABLE IF NOT EXISTS community.quotas (
  key text PRIMARY KEY,
  users integer NOT NULL DEFAULT 0,
  skills integer NOT NULL DEFAULT 0,
  versions integer NOT NULL DEFAULT 0,
  bytes bigint NOT NULL DEFAULT 0
);
INSERT INTO community.quotas(key,users,skills,versions,bytes)
SELECT 'global',(SELECT count(*) FROM community.users),(SELECT count(*) FROM community.skills),
  count(*),COALESCE(sum(octet_length(body)+octet_length(description)+octet_length(name)+512),0)+
    COALESCE((SELECT sum(octet_length(r.reason)+512) FROM community.reports r),0)
FROM community.versions ON CONFLICT(key) DO NOTHING;
INSERT INTO community.quotas(key,skills,versions,bytes)
SELECT 'user:'||u.id,
  (SELECT count(*) FROM community.skills s WHERE s.owner_id=u.id),
  (SELECT count(*) FROM community.versions v JOIN community.skills s ON s.id=v.skill_id WHERE s.owner_id=u.id),
  COALESCE((SELECT sum(octet_length(v.body)+octet_length(v.description)+octet_length(v.name)+512)
    FROM community.versions v JOIN community.skills s ON s.id=v.skill_id WHERE s.owner_id=u.id),0)+
  COALESCE((SELECT sum(octet_length(r.reason)+512) FROM community.reports r WHERE r.user_id=u.id),0)
FROM community.users u ON CONFLICT(key) DO NOTHING;

CREATE OR REPLACE FUNCTION community.register_user(input_id uuid,input_username text,input_hash text)
RETURNS TABLE(id uuid,username text) LANGUAGE plpgsql AS $$
DECLARE quota community.quotas%ROWTYPE;
BEGIN
  SELECT q.* INTO quota FROM community.quotas q WHERE q.key='global' FOR UPDATE;
  IF quota.users>=10000 OR pg_database_size(current_database())>=419430400 THEN
    RAISE EXCEPTION 'Account capacity reached' USING ERRCODE='P0001';
  END IF;
  INSERT INTO community.users(id,username,password_hash) VALUES(input_id,input_username,input_hash);
  INSERT INTO community.quotas(key) VALUES('user:'||input_id);
  UPDATE community.quotas q SET users=q.users+1 WHERE q.key='global';
  RETURN QUERY SELECT input_id,input_username;
END $$;

CREATE OR REPLACE FUNCTION community.publish_skill(input_user uuid,input_skill uuid,input_name text,
  input_description text,input_body text,input_digest text,input_agents text[])
RETURNS TABLE(skill_id uuid,published_version integer,name text,description text,digest text,
  supported_agents text[],created_at timestamptz) LANGUAGE plpgsql AS $$
DECLARE
  global_quota community.quotas%ROWTYPE;
  user_quota community.quotas%ROWTYPE;
  chosen_id uuid;
  previous_version integer;
  new_skill boolean;
  charge bigint;
BEGIN
  SELECT q.* INTO global_quota FROM community.quotas q WHERE q.key='global' FOR UPDATE;
  SELECT q.* INTO user_quota FROM community.quotas q WHERE q.key='user:'||input_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Author unavailable' USING ERRCODE='P0002'; END IF;
  IF input_skill IS NULL THEN
    SELECT s.id,s.latest_version INTO chosen_id,previous_version FROM community.skills s
      WHERE s.owner_id=input_user AND s.name=input_name FOR UPDATE;
    new_skill:=NOT FOUND;
    IF new_skill THEN chosen_id:=gen_random_uuid(); previous_version:=0; END IF;
  ELSE
    SELECT s.id,s.latest_version INTO chosen_id,previous_version FROM community.skills s
      WHERE s.id=input_skill AND s.owner_id=input_user AND s.name=input_name FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Skill unavailable' USING ERRCODE='P0002'; END IF;
    new_skill:=false;
  END IF;
  charge:=octet_length(input_body)+octet_length(input_description)+octet_length(input_name)+512;
  IF user_quota.versions>=250 OR user_quota.bytes+charge>10485760 OR
     (new_skill AND user_quota.skills>=100) OR previous_version>=1000 OR
     global_quota.versions>=20000 OR global_quota.bytes+charge>419430400 OR
     pg_database_size(current_database())+charge>419430400 THEN
    RAISE EXCEPTION 'Publishing quota reached' USING ERRCODE='P0001';
  END IF;
  IF new_skill THEN
    INSERT INTO community.skills(id,owner_id,name,latest_version) VALUES(chosen_id,input_user,input_name,1);
  ELSE
    UPDATE community.skills s SET latest_version=previous_version+1,visible=true,updated_at=now() WHERE s.id=chosen_id;
  END IF;
  INSERT INTO community.versions(skill_id,version,name,description,body,digest,supported_agents)
    VALUES(chosen_id,previous_version+1,input_name,input_description,input_body,input_digest,input_agents);
  UPDATE community.quotas q SET skills=q.skills+CASE WHEN new_skill THEN 1 ELSE 0 END,
    versions=q.versions+1,bytes=q.bytes+charge WHERE q.key IN ('global','user:'||input_user);
  RETURN QUERY SELECT v.skill_id,v.version,v.name,v.description,v.digest,v.supported_agents,v.created_at
    FROM community.versions v WHERE v.skill_id=chosen_id AND v.version=previous_version+1;
END $$;

CREATE OR REPLACE FUNCTION community.create_session(input_user uuid,input_hash text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  PERFORM q.key FROM community.quotas q WHERE q.key='user:'||input_user FOR UPDATE;
  DELETE FROM community.sessions s WHERE s.user_id=input_user AND s.expires_at<now();
  DELETE FROM community.sessions s WHERE s.token_hash IN (
    SELECT t.token_hash FROM community.sessions t WHERE t.user_id=input_user
      ORDER BY t.created_at DESC,t.token_hash OFFSET 19
  );
  INSERT INTO community.sessions(token_hash,user_id,expires_at) VALUES(input_hash,input_user,now()+interval '7 days');
END $$;

CREATE OR REPLACE FUNCTION community.report_skill(input_user uuid,input_skill uuid,input_reason text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  global_quota community.quotas%ROWTYPE;
  user_quota community.quotas%ROWTYPE;
  previous_reason text;
  new_report boolean;
  charge bigint;
BEGIN
  SELECT q.* INTO global_quota FROM community.quotas q WHERE q.key='global' FOR UPDATE;
  SELECT q.* INTO user_quota FROM community.quotas q WHERE q.key='user:'||input_user FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM community.skills s WHERE s.id=input_skill AND s.visible) THEN
    RAISE EXCEPTION 'Skill unavailable' USING ERRCODE='P0002';
  END IF;
  SELECT r.reason INTO previous_reason FROM community.reports r
    WHERE r.skill_id=input_skill AND r.user_id=input_user FOR UPDATE;
  new_report:=NOT FOUND;
  charge:=octet_length(input_reason)-COALESCE(octet_length(previous_reason),0)+CASE WHEN new_report THEN 512 ELSE 0 END;
  IF (new_report AND ((SELECT count(*) FROM community.reports r WHERE r.user_id=input_user)>=100 OR
      (SELECT count(*) FROM community.reports)>=10000)) OR
      (charge>0 AND (user_quota.bytes+charge>10485760 OR global_quota.bytes+charge>419430400 OR
        pg_database_size(current_database())+charge>419430400)) THEN
    RAISE EXCEPTION 'Report quota reached' USING ERRCODE='P0001';
  END IF;
  INSERT INTO community.reports(skill_id,user_id,reason) VALUES(input_skill,input_user,input_reason)
    ON CONFLICT(skill_id,user_id) DO UPDATE SET reason=EXCLUDED.reason;
  UPDATE community.quotas q SET bytes=q.bytes+charge WHERE q.key IN ('global','user:'||input_user);
END $$;

CREATE OR REPLACE FUNCTION community.reject_version_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Published skill versions are immutable';
END $$;
DROP TRIGGER IF EXISTS community_version_immutable ON community.versions;
CREATE TRIGGER community_version_immutable BEFORE UPDATE OR DELETE ON community.versions
FOR EACH ROW EXECUTE FUNCTION community.reject_version_mutation();

REVOKE ALL ON SCHEMA community FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA community FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA community FROM PUBLIC;
