-- Stores the template's name at the moment the envelope is created, so
-- the completion certificate reflects the actual document title instead
-- of a hardcoded string (and stays accurate even if the template is later
-- renamed).
alter table signing_requests add column if not exists document_title text;
