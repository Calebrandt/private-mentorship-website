-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15c-Daniel-Backfill: ~90 sessions for Daniel Jiang
-- ─────────────────────────────────────────────────────────────────────────
-- One row per session from owner's Google Sheets lesson tracker.
-- For each session: create appointment + hours_ledger row + lesson_log
-- + file/URL attachments.
--
-- FIELD MAPPING:
--   Lesson Focus       → focus_area
--   Status             → status_label (mapped to enum values)
--   Type               → type_label (mostly life_skills_task,
--                        independent_task for tests/exams)
--   Session/HW/Multimedia Files → file rows (legacy/google-drive paths)
--   Video URL          → URL attachment
--   Feedback           → feedback
--   Performance Rating → rating (0-5)
--   Bell-Ringer        → key_concepts (text) + file attachments
--   Next Lesson Notes  → next_session_notes
--
-- APPOINTMENTS: kind='reserved' for sessions matching Mon-eve / Thu-aft
-- pattern, 'extra_billable' for off-pattern weekends/odd times.
-- Status='completed', tied to whichever contract covers the date.
--
-- Safe to re-run only after wiping Daniel's data.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TEMP TABLE _daniel_sessions (
  session_date date,
  start_time   time,
  end_time     time,
  focus_area   text,
  key_concepts text,
  status_label text,
  type_label   text,
  feedback     text,
  rating       int,
  f1 text, f2 text, f3 text, f4 text, f5 text, f6 text,
  url1 text, url2 text,
  next_notes   text
) ON COMMIT DROP;

INSERT INTO _daniel_sessions VALUES
('2025-01-01','14:00','16:00','Grammar',NULL,NULL,'life_skills_task','Excellent work!',4,NULL,NULL,NULL,'Ryan - Daily English Lesson: Practical Phrases and Activities at Home',NULL,NULL,NULL,NULL,NULL),
('2025-01-20','14:00','16:00','Continuous Tense Introduction',NULL,'in_progress','life_skills_task','Great work!',3,'Daniel - Practice Exercises: Mastering the Continuous Tenses','Ryan - Learning About Continuous Tenses','The Continuous Tenses Introduction','Introduction to the Continuous Tense','Continuous vs Simple Tense - Homework','Multimedia',NULL,NULL,NULL),
('2025-01-23','14:03','16:10','Subject + Predicate',NULL,NULL,'life_skills_task','Great Work!',3,NULL,'January 23 2025 Feedback for Lesson Tracker','Homework Document: Subjects, Predicates, Nouns, and Verbs',NULL,NULL,'Subject & Predicate (Bell-Ringer)',NULL,NULL,NULL),
('2025-01-27','14:02','16:16','Noun & FANBOYS',NULL,'in_progress','life_skills_task','Very good effort & attention!',4,'DANIELS FANBOYS EXERCISE','January 27 2025 - Ryans/Nouns','Daniels FANBOYS Exercises #2','FANBOYS (Coordinating Conjunctions) Homework',NULL,NULL,NULL,NULL,NULL),
('2025-01-30','14:00','16:20','Ryan: Proper & Common Nouns / Daniel: FANBOYS & AWHITEBUS',NULL,'in_progress','life_skills_task','Excellent effort & attention',4,'Coordinating vs Subordinating Conjunctions','January 30 2025 - Ryan (Proper & Common Noun)',NULL,'Daniel: Conjunctions Practice: Commas & Clauses','Ryan Jiang - Noun Quest: Common vs Proper','Daniel and Ryan - January 30 2025 (Bell-Ringer)',NULL,NULL,NULL),
('2025-02-03','14:00','16:00','Ryan: Proper & Common Nouns / Daniel: FANBOYS & AWHITEBUS',NULL,'in_progress','life_skills_task','Excellent work!',4,'Daniel (Clauses) February 3 2025','Proper & Common Noun - February 3 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-02-06','14:00','16:13','Ryan: Proper & Common Nouns / Daniel: FANBOYS & AWHITEBUS',NULL,'in_progress','life_skills_task','Great Work!',3,'AWHITEBUS 2025-FEB-06','FEB 06 2025 - PROPER AND COMMON NOUNS','Homework: Common and Proper Nouns','Daniel Homework - Understanding and Using Subordinating Conjunctions',NULL,'FEB 6 2025 RYAN (Bell-Ringer)',NULL,NULL,NULL),
('2025-02-10','14:00','16:00','Independent & Dependent Clauses + 4 English Sentence Structures',NULL,'in_progress','life_skills_task','Outstanding work Daniel!',5,'Daniel - Sentence Structures & Clauses Homework',NULL,NULL,NULL,NULL,'Daniel February 10 2025 (Bell-Ringer)',NULL,NULL,NULL),
('2025-02-13','14:00','16:00','Daniel: Prepositions, Phrases, Clauses',NULL,'in_progress','life_skills_task','Excellent effort & attention',5,NULL,'Daniel Worksheet: Phrases and Clauses',NULL,NULL,NULL,'Prepositional & Clause Phrases (Bell-Ringer)','https://irsc-asc.weebly.com/uploads/3/1/8/1/31813909/packet_4_phrases_and_clauses.pdf',NULL,NULL),
('2025-02-20','14:00','16:10','Daniel: Prepositions & Phrases',NULL,'in_progress','life_skills_task','Excellent effort & attention',5,'Lesson Plan: Phrases and Clauses Review & Sentence Writing Practice',NULL,'Prepositions and Prepositional Phrases – Homework Assignment',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-02-27','14:00','16:00','3 Clause Sentence (2 ideas each clause)',NULL,'in_progress','life_skills_task','Excellent effort & attention',5,'Private Mentorship - English Class (Jiang) 3Clause/6Ideas',NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Continue - 3 Clause 6 Ideas'),
('2025-03-17','15:00','17:00','3 Clause Sentence: 3 simple Sentences to 1 Compound-Complex Sentence',NULL,'in_progress','life_skills_task','Great Work!',4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-03-24','15:00','17:00','Sentence Fragments',NULL,NULL,'life_skills_task','Remember to stay focused!',3,'March 24 2025 (Sentence Fragments)',NULL,'Homework March 24 2025.png',NULL,NULL,'Sentence Fragments (Bell-Ringer)','https://literacyservices.org/class/wp-content/uploads/2023/03/Complete-Sentences.pdf',NULL,NULL),
('2025-03-27','15:00','17:00','Run-On Sentences',NULL,NULL,'life_skills_task','Remember to stay focused!',2,'Run-On Sentences March 27 2025',NULL,'🚨 Run-On Sentences: Sentence Crashes Ahead','Daniel Jiang Mar 27, 2025',NULL,'Run-On Sentences (Bell-Ringer)',NULL,NULL,NULL),
('2025-03-31','15:30','17:30','Phrases VS Clauses',NULL,NULL,'life_skills_task','Remember to stay focused!',1,'Private Mentorship - English Class (Jiang) 2025-03-31',NULL,'Phrases_vs_Clauses_Workbook 3.pdf','Daniel''s Review & Lesson: Phrases vs','Sentence Connection Challenge: PART 3 Practice Exercises',NULL,NULL,NULL,NULL),
('2025-04-03','15:00','17:00','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task','Excellent effort & attention',5,'✍️ TEEL Writing Practice: Paragraph Builder',NULL,NULL,NULL,NULL,'April 3 2025 - Paragraph TEEC (Bell-Ringer)',NULL,NULL,NULL),
('2025-04-07','15:00','17:00','Phrases VS Clauses',NULL,'in_progress','life_skills_task','Constantly Looking Off-Screen & Getting Distracted',1,'Private Mentorship - Daniel Jiang''s English Class 2025-04-07',NULL,'Homework April 7 2025','📘 TEEL Paragraph Writing – Homework 课后作业',NULL,NULL,NULL,NULL,NULL),
('2025-04-10','15:00','17:00','Exam - 20 Section (1-5)',NULL,'in_progress','independent_task','Remember to stay focused & NO CHEATING',4,'Daniel''s Exam: English Grammar & Writing',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-14','15:00','17:00','Exam - 20 Section (6-11)',NULL,'in_progress','independent_task','Constantly Looking Off-Screen & Getting Distracted',1,'Exam - Progress Report / April 14 2025 (Daniel)',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-17','15:00','17:00','Exam - 20 Section (Only 12)',NULL,'in_progress','independent_task','Constantly Looking Off-Screen & Getting Distracted',1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-28','15:00','17:00','Introduction Topic Sentence',NULL,NULL,'life_skills_task','Constantly Looking Off-Screen & Getting Distracted',1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-01','15:00','17:00','Topic Sentence: Main Idea + 2 Supporting Details',NULL,'in_progress','life_skills_task','Constantly Looking Off-Screen & Getting Distracted',1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-05','15:00','17:00','Topic Sentence: Main Idea + 2 Supporting Details',NULL,'in_progress','life_skills_task','Constantly Looking Off-Screen & Getting Distracted',NULL,'May 5th 2025 Topic Sentence',NULL,NULL,'Daniel''s Topic Sentence Homework - May 5 2025',NULL,NULL,NULL,NULL,NULL),
('2025-05-08','15:00','16:30','Essay - Hook & Introduction',NULL,'in_progress','life_skills_task','Constantly Looking Off-Screen & Getting Distracted',5,'Introduction',NULL,'May 8 2025 (1st day Essay) Lessons','📝 Daniel''s Homework: How to Write a Strong Introduction',NULL,NULL,'https://www.youtube.com/watch?v=uAFP7a9Xd_Q',NULL,NULL),
('2025-05-12','15:00','17:30','Essay - Introduction+Hook+Background',NULL,'in_progress','life_skills_task','Constantly Looking Off-Screen & Getting Distracted',5,'Private Mentorship - Daniel Jiang''s English Class 2025-05-12',NULL,'📝 Writing an Introduction Paragraph',NULL,NULL,NULL,'https://www.youtube.com/watch?v=4WDclqoGouY',NULL,NULL),
('2025-05-15','15:00','17:30','Backgrounds + quote',NULL,'in_progress','life_skills_task','Stop copying and pasting information; stop repeating everything in your writing',3,'Private Mentorship - Daniel Jiang''s English Class 2025-05-15',NULL,'Daniel_Quote_Background_Thesis_Practice.docx','Daniel_Introduction_Flow_Thesis_Homework.docx',NULL,NULL,NULL,NULL,NULL),
('2025-05-19','15:00','17:40','Essay Template',NULL,NULL,'life_skills_task','Excellent effort & attention',5,'May 19 2025 - Essay Template',NULL,'📝 Daniel''s Essay Mapping Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-22','15:30','17:30','Transition Words (Explanation & Examples) + Adding Detail',NULL,NULL,'life_skills_task','Poor Attitude + Talking Back + Joking Too Much',2,'TEEC and Transitions to Build Amazing Paragraphs',NULL,'📚 Daniel''s TEEC Writing Homework',NULL,NULL,'Private Mentorship - Daniel English Class 2025-05-22 (Bell-Ringer)','https://www.youtube.com/watch?v=aTmCWLIA0K8',NULL,NULL),
('2025-05-26','15:00','17:00','Paraphrasing + Synonyms',NULL,NULL,'life_skills_task','Excellent effort & attention',5,'📝 Lesson: Introduction to Synonyms','📝 Lesson: Introduction to Paraphrasing','Private Mentorship - Daniel Jiang''s English Class 2025-05-26','📘 Daniel''s Writing Homework – Paraphrasing & Synonyms Practice','Paraphrasing_Homework_Booklet_Daniel.pdf','Synonyms_Homework_Booklet_Daniel.pdf',NULL,NULL,NULL),
('2025-05-29','15:00','17:00','Paraphrasing + Synonyms',NULL,'in_progress','life_skills_task',NULL,1,'May 29 2025 (Paraphrasing)',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-05','15:00','17:00','Paraphrasing (Line by Line) Worksheet',NULL,'in_progress','life_skills_task',NULL,NULL,'June 5 2025 Daniel Jiang',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-09','15:00','17:22','Paraphrasing (Line by Line) Worksheet',NULL,'in_progress','life_skills_task',NULL,NULL,'Paraphrasing June 9 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-12','16:00','18:00','Jack & The Beanstalk (paraphrasing)',NULL,'in_progress','life_skills_task',NULL,NULL,'Private Mentorship - Daniel Jiang''s English Class 2025-06-09',NULL,'📘 Jack and the Beanstalk – Paraphrasing Essay Assignment',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-16','18:08','20:08','Jack & The Beanstalk (Essay)',NULL,'in_progress','life_skills_task',NULL,NULL,'🎬 Jack and the Beanstalk Essay Assignment for Daniel',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-19','15:30','16:30','Practice Quoting',NULL,'in_progress','life_skills_task',NULL,NULL,'📘 Quoting Practice Exercises – For Daniel',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-26','15:30','16:30','Parentheses & Brackets','Summer Break Starts','in_progress','life_skills_task',NULL,NULL,'📝 Brackets Practice – Daniel''s Worksheet',NULL,'📝 Brackets Practice – Daniel''s Worksheet',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-10','15:00','18:00','Catch Up - Sentences & Paragraphs',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-11','17:30','19:30','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-17','17:30','19:54','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-22','15:15','17:15','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-29','17:30','18:41','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-02','17:30','19:30','Paragraph Writing (T.E.E.C)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-06','17:30','19:30','Learning New Words / Refreshing Old Concepts',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-09','17:30','19:30','Simple Tense: Present, Past, Future',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-16','17:30','19:30','Continuous Tense: Present, Past, Future',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📝 Daniel''s English Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-20','18:00','20:00','Perfect Tense: Present, Past, Future',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'October 20 2025 - Tense',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-23','17:30','19:30','Perfect Tense: Present, Past, Future',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Perfect Tense Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-30','17:30','19:30','Continuous-Perfect Tense: Present, Past, Future',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniel Jiang - Tense Package',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-06','15:30','17:33','Memorizing Tense Structure',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-13','17:30','19:30','Writing Exercises - Tenses, Structures',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 DANIEL — Present Simple Mastery Lesson & Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-17','18:00','20:00','Writing Exercises - Tenses, Structures',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 DANIEL – TWO-CLAUSE SENTENCE',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-20','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 DANIEL''S CLAUSE PACKAGE',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-24','18:00','20:00','Compound: Object, Subject, Predicate, Sentence',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 Daniel — Hard-Hard Mixed Grammar Test',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-27','16:00','18:00','Compound: Object, Subject, Predicate, Sentence',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 DANIEL — 200 Mixed Grammar Questions (Hard → Extremely Hard)',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-12-01','18:00','20:00','Application Writing Assignment: 3 Body Paragraph',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'📘 Daniel — Grammar Writing Assignment',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-12-02','16:00','18:00','Application Writing Assignment: 3 Body Paragraph -- Continued',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-12-15','18:00','20:10','Application Writing Assignment: 3 Body Paragraph -- Continued',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Homework for Daniel','📘 Daniel — Grammar Writing Assignment',NULL,NULL,NULL,NULL,NULL),
('2026-01-05','18:00','20:00','Application Writing Assignment: 3 Body Paragraph -- Continued',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-08','16:00','18:00','Sentence specifics (compound differences)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniel Jiang 2026-01-08','SHORT LESSON (READ TOGETHER)',NULL,NULL,NULL,NULL,NULL),
('2026-01-12','18:00','20:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Advanced Identification',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-15','16:00','18:00','Advanced Clauses',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniel Yang -- Advanced Grammar',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-19','18:00','20:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Examples for Daniel -- Advanced Grammar','Daniel Yang -- Advanced Grammar',NULL,NULL,NULL,NULL),
('2026-01-22','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniel – Clause Identification Worksheet',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-26','18:00','20:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-29','16:00','18:00','Sentence Variety (Compound Sentences)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'What defines a complex sentence (the core rule)','Daniel – Comprehensive Sentence Structure Exam',NULL,NULL,NULL,NULL,NULL),
('2026-02-02','16:00','18:00','Semicolon & Sentence Variety',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniel – Semicolon vs Comma','What is a conjunctive adverb','Daniel – Comprehensive Sentence Structure Exam',NULL,NULL,NULL,NULL),
('2026-02-05','16:00','18:00','Sentence Variety (Complex Sentences)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-12','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-19','16:00','18:00','Paragraph Writing - Controlling Idea',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-23','18:00','20:00','Paragraph Writing - Controlling Idea',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-26','16:00','18:00','Adding Sentences to TEEC',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Daniels Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-02','18:00','20:00','Adding Sentences to TEEC',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'Adding Sentences TEEC',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-05','16:30','18:30','Adding Sentences to TEEC',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-09','18:00','20:00','Essay Writing',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-12','16:00','18:00','Essay Discussion & Introduction Paragraph',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-16','18:00','20:00','HOW TO WRITE A BODY PARAGRAPH',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'HOW TO WRITE A BODY PARAGRAPH','HOW TO WRITE A STRONG INTRODUCTION PARAGRAPH',NULL,NULL,NULL,NULL,NULL),
('2026-03-19','16:00','18:20','Transition Sentence',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-23','18:00','20:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'WRITING WORKBOOK – PART 3','📘 Daniel''s Writing Workbook','TRANSITION WORD & PHRASE BANK',NULL,NULL,NULL,NULL),
('2026-03-30','18:00','20:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-02','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-13','18:30','20:30',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-16','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,'✏️ WRITING HOMEWORK',NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-20','18:00','20:00','PLOT STRUCTURE (ENGLISH)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-23','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-27','16:00','18:00','PLOT STRUCTURE (ENGLISH) Rising Action',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-30','16:00','18:00','PLOT STRUCTURE (ENGLISH) Rising Action',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-04','18:00','20:00','PLOT STRUCTURE (ENGLISH) Developing Ideas 1,2 and 3',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-07','16:00','18:00','PLOT STRUCTURE (ENGLISH) Story Writing',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-11','18:00','20:00','Life skills - Bedroom, Family, Public Life theory',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-14','16:00','18:00','Discovery to Know Yourself',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'https://www.youtube.com/watch?v=1gdHZ3wDiZc',NULL,NULL);


-- ─── Insert appointments — one per session row ──────────────────────────
DO $$
DECLARE
  v_client_id      uuid;
  v_test_assistant uuid := '186282d5-96e8-45b6-a9f5-718db4c60913';
  v_caleb          uuid := '9b7b4106-1914-4062-818d-3074a0d2f7ff';
  v_tz             text := 'America/Vancouver';
  r record;
  v_contract_id    uuid;
  v_duration       int;
  v_kind           text;
  v_dow            int;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE full_name = 'Daniel Jiang' LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Daniel Jiang not found. Run Phase 15c-Foundation first.';
  END IF;

  FOR r IN SELECT * FROM _daniel_sessions ORDER BY session_date LOOP
    -- Find the contract covering this date
    SELECT id INTO v_contract_id
      FROM public.contracts
      WHERE client_id = v_client_id
        AND start_at <= (r.session_date::text || ' ' || r.start_time::text)::timestamp AT TIME ZONE v_tz
        AND end_at   >= (r.session_date::text || ' ' || r.end_time::text)::timestamp AT TIME ZONE v_tz
      LIMIT 1;
    -- Compute duration in minutes
    v_duration := GREATEST(15, EXTRACT(EPOCH FROM (r.end_time - r.start_time))::int / 60);
    -- Determine kind by recurring pattern (Mon=1, Thu=4)
    v_dow := EXTRACT(DOW FROM r.session_date);
    v_kind := CASE
      WHEN v_dow IN (1, 4) AND r.start_time IN (TIME '18:00:00', TIME '16:00:00') THEN 'reserved'
      ELSE 'extra_billable'
    END;
    INSERT INTO public.appointments
      (client_id, contract_id, assistant_id, kind, status, starts_at, ends_at,
       duration_minutes, title, created_by, updated_at)
    VALUES
      (v_client_id, v_contract_id, v_test_assistant, v_kind::public.appointment_kind, 'completed',
       (r.session_date::text || ' ' || r.start_time::text)::timestamp AT TIME ZONE v_tz,
       (r.session_date::text || ' ' || r.end_time::text)::timestamp AT TIME ZONE v_tz,
       v_duration,
       COALESCE(LEFT(r.focus_area, 100), 'English Tutoring Session'),
       v_caleb, NOW());
  END LOOP;
END $$;


-- ─── Insert hours_ledger rows — one per appointment ─────────────────────
INSERT INTO public.hours_ledger
  (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
SELECT
  a.client_id, a.contract_id, a.id, -a.duration_minutes, 'session_completed',
  jsonb_build_object('source','phase-15c-daniel-backfill', 'kind','backfilled_from_manual_tracker',
                     'session_date', (a.starts_at AT TIME ZONE 'America/Vancouver')::date),
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'
FROM public.appointments a
JOIN public.clients c ON c.id = a.client_id
WHERE c.full_name = 'Daniel Jiang' AND a.status = 'completed';


-- ─── Insert lesson_logs — one per session via temp-table join ───────────
INSERT INTO public.session_lesson_logs
  (appointment_id, client_id, assistant_id, assistant_display_name,
   focus_area, key_concepts, status_label, type_label,
   feedback, rating, next_session_notes, created_by)
SELECT
  a.id, a.client_id,
  '186282d5-96e8-45b6-a9f5-718db4c60913'::uuid, 'TYASSISTANT',
  s.focus_area, s.key_concepts, s.status_label, s.type_label,
  s.feedback, NULLIF(s.rating, 0), s.next_notes,
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'::uuid
FROM _daniel_sessions s
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Daniel Jiang' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = s.session_date
WHERE NOT EXISTS (SELECT 1 FROM public.session_lesson_logs l WHERE l.appointment_id = a.id);


-- ─── Insert files/URLs ─────────────────────────────────────────────────
INSERT INTO public.session_lesson_files
  (lesson_log_id, kind, display_name, storage_path, external_url,
   uploaded_by, uploaded_by_role, uploaded_by_display_name)
SELECT
  l.id,
  CASE WHEN x.kind = 'file' THEN 'file' ELSE 'url' END,
  x.value,
  CASE WHEN x.kind = 'file' THEN 'legacy/google-drive/' || x.value ELSE NULL END,
  CASE WHEN x.kind = 'url'  THEN x.value ELSE NULL END,
  '186282d5-96e8-45b6-a9f5-718db4c60913'::uuid,
  'assistant', 'TYASSISTANT'
FROM _daniel_sessions s
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Daniel Jiang' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = s.session_date
JOIN public.session_lesson_logs l ON l.appointment_id = a.id
JOIN LATERAL (VALUES
  ('file', s.f1), ('file', s.f2), ('file', s.f3),
  ('file', s.f4), ('file', s.f5), ('file', s.f6),
  ('url',  s.url1), ('url',  s.url2)
) x(kind, value) ON x.value IS NOT NULL;


-- ─── Verification ──────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM _daniel_sessions) AS source_rows,
  (SELECT COUNT(*) FROM public.appointments a JOIN public.clients c ON c.id = a.client_id WHERE c.full_name = 'Daniel Jiang') AS appointments,
  (SELECT COUNT(*) FROM public.hours_ledger l JOIN public.clients c ON c.id = l.client_id WHERE c.full_name = 'Daniel Jiang') AS ledger_rows,
  (SELECT COUNT(*) FROM public.session_lesson_logs ll JOIN public.clients c ON c.id = ll.client_id WHERE c.full_name = 'Daniel Jiang') AS lesson_logs,
  (SELECT COUNT(*) FROM public.session_lesson_files f
    JOIN public.session_lesson_logs ll ON ll.id = f.lesson_log_id
    JOIN public.clients c ON c.id = ll.client_id WHERE c.full_name = 'Daniel Jiang') AS files;

COMMIT;
