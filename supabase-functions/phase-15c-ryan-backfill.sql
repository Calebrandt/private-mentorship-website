-- Phase 15c-Ryan-Backfill: ~110 sessions for Ryan Roe.
-- Same pattern as Daniel's backfill but with Ryan-specific quirks:
--   - Reward text gets appended to feedback (gamification visible to family)
--   - JOIN uses date + start_time to handle 2 duplicate-date rows
--   - 5/30/2025 second session shifted to 18:30 for uniqueness
--   - "Free Session" no-date row skipped entirely

BEGIN;

CREATE TEMP TABLE _ryan_sessions (
  session_date date, start_time time, end_time time,
  focus_area text, key_concepts text, status_label text, type_label text,
  feedback text, rating int,
  f1 text, f2 text, f3 text, f4 text, f5 text, f6 text,
  url1 text, url2 text, next_notes text
) ON COMMIT DROP;

INSERT INTO _ryan_sessions VALUES
('2025-01-12','15:30','17:30','Balancing Sentences',NULL,NULL,'life_skills_task','Great work! · 🎉 Verbal Praise (3 Stars)',3,'Quick Notes: Difference Between Transition Words and Conjunctions','Comprehensive Sentence Writing and Tense Mastery Exercise',NULL,NULL,'Examples of Tense Sequences',NULL,NULL,NULL,NULL),
('2025-01-17','15:30','17:30','(2) Tests: Tenses & Conjunctions',NULL,'completed','independent_task','Great job on your test! (78-81.7%) · 🖍️ Creative Activity Time (4 Stars)',4,'Comprehensive Sentence Writing and Tense Mastery Test','Ryan''s Advanced Conjunctions Mastery Test','correlative conjunctions worksheet PDF.pdf','Unit 1: Correlative Conjunctions (Introduction)','Important Homework Assignment - Ryan',NULL,NULL,NULL,NULL),
('2025-01-19','15:30','17:30','Missed Appointment',NULL,'needs_improvement','life_skills_task','Disappointed! · 💪🏻 Keep Trying (1-2 Stars)',1,'Unit 1: Correlative Conjunctions and Sentence Structure Lesson Plan',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-01-22','15:30','17:30','Bell-Ringer Introduction','Bell-Ringer: Quotation & Video Journal',NULL,'social_engagement','Lacking Motivation & Effort · 💪🏻 Keep Trying (1-2 Stars)',2,'Ryan - Incident Report - January 22 2025','Ryans Schedule','Vocabulary Bell Ringers Lesson 1','Grammar Bell Ringer Lesson 1',NULL,'Wise Word: Written Response',NULL,NULL,NULL),
('2025-01-24','15:30','17:30','(Simple+Complete) Subject/Predicate','Bell-Ringer: Quotations (friday)',NULL,'life_skills_task','Great Motivation & Engagement! · ✏️ Free Choice Writing (4 Stars)',4,NULL,NULL,'(2) Subject + (2) Predicate - January 24 2025','Homework: Compound Subject & Predicate',NULL,'Jan 24 2025 Multimedia',NULL,NULL,NULL),
('2025-01-26','15:00','17:00','Figurative Language: 10 Devices','Bell-Ringer: Figurative Language (sunday)',NULL,'life_skills_task','Terrific Motivation & Engagement! · 📖 Storytime Reward (5 Stars)',5,'Figurative Language Worksheet',NULL,NULL,NULL,NULL,'Figure Language: Lesson 1 (Bell-Ringer)',NULL,NULL,NULL),
('2025-02-05','15:30','17:30','Vocabulary & Speech Planning','Bell-Ringer: Vocabulary (wednesday)',NULL,'social_engagement','Disappointed! · 💪🏻 Keep Trying (1-2 Stars)',2,'PersuasiveSpeechPlanners',NULL,NULL,NULL,NULL,'Speech Planner',NULL,NULL,NULL),
('2025-02-07','15:40','17:40','Speech Writing - "If My Mother Was Sick"',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! Keep it up! · 🌟 Special Outing (5 Stars)',5,'Instructions - Speech Writing Instructions',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-02-09','15:30','17:30','Continued: Speech Writing - "If My Mother Was Sick"',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'Continue Writing Ryans Speech'),
('2025-02-12','15:30','17:30','1st, 2nd, 3rd Conditional Sentences',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,'1st, 2nd, 3rd - Conditional Sentences','Feedback & Areas for Improvement',NULL,NULL,NULL,'Ryan Tense Guide.png','https://www.youtube.com/watch?v=xwOCqtaZDrk',NULL,NULL),
('2025-02-14','15:44','17:44','1st, 2nd, 3rd Conditional Sentences',NULL,'in_progress','life_skills_task','Keep up the good work! · 🎉 Verbal Praise (3 Stars)',3,NULL,'50 different third conditional sentences','Homework February 14 2025',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-02-16','15:00','17:00','3 Clause Sentences + "That"',NULL,'in_progress','life_skills_task','Disappointed! · 💪🏻 Keep Trying (1-2 Stars)',1,'How to use "That" to Add More Detail in Sentences',NULL,'Homework Assignment: Writing Compound-Complex Sentences with "That"',NULL,NULL,NULL,NULL,NULL,'Continue writing 3 clause sentences'),
('2025-02-19','15:30','17:30','3 Clause Sentences',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🗓️ Skip Homework (5 Stars)',5,NULL,NULL,'📚 Ryan''s Homework: Advanced Three-Clause Sentences & Noun Clauses',NULL,NULL,'Sentence Structure and Clauses (Bell-Ringer)','https://zameroskiwebpage.weebly.com/uploads/1/3/3/2/13324979/compound-complex_worksheet.pdf',NULL,NULL),
('2025-02-21','15:30','17:30','Advanced 3 Clause Sentences',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,NULL,NULL,'Advanced Three-Clause Sentences',NULL,NULL,NULL,NULL,NULL,'Check Ryans advanced clause worksheet'),
('2025-02-26','15:30','17:30','3 Clause Sentences Continuation',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-03-16','15:00','17:00','3 Clause Sentences - Logical Compound-Complex Sentences',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-03-21','14:00','16:00','Sentence Fragments',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-03-26','16:00','18:00','Run-On Sentences',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,NULL,NULL,'Private Mentorship English Class Ryan 2025-03-26 (PDF)','March 26 2025 Homework: Sentence Correction & Development',NULL,'Screenshot 2025-03-26 at 5.14.43 PM.png',NULL,NULL,NULL),
('2025-03-28','16:00','18:00','Complete Review + More (start day)',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,NULL,NULL,NULL,'March 29 2025: Homework Assignment – Sentence Writing',NULL,NULL,NULL,NULL,NULL),
('2025-04-02','15:30','17:30','Review + Writing + Returning Back To Paragraph Writing',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'Sentence Connection Challenge: PART 3 Practice Exercises',NULL,NULL,NULL,NULL,'Private Mentorship English Class Ryan 2025-04-02 (PDF)',NULL,NULL,NULL),
('2025-04-04','15:30','17:30','Sentence Starters + Paragraph Writing',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'Private Mentorship English Class Ryan 2025-04-04 (PDF)',NULL,'APRIL 2 2025 Homework Assignment','🧠 (3) (Exercise) April 4 2025','(Homework) April 4 2025',NULL,NULL,NULL,NULL),
('2025-04-06','15:00','17:00','Deeper Dive Into Phrases & Clauses',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,NULL,NULL,'Homework_Review_Phrases_Clauses_and_Writing.pdf',NULL,'Private Mentorship English Class Ryan 2025-04-06 (PDF)',NULL,NULL,NULL,NULL),
('2025-04-09','15:30','17:30','1st, 2nd, and 3rd Person',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,'1st, 2nd, 3rd person',NULL,'Ryan homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-11','15:30','19:30','Exam - 47 Section (section 1-4)',NULL,'in_progress','independent_task','Excellent attitude, effort, and respect! · 📆 Session Off (5 Stars)',5,'Ryans Exam: English Grammar & Writing','Exam - Progress Report / April 11 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-13','15:00','18:20','Exam - 47 Section (section 5-12) Skipped the bonus correlative',NULL,'in_progress','independent_task','Great work! Please invest more effort into your sentences! · ✏️ Free Choice Writing (4 Stars)',4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-16','15:30','17:30','Exam - 47 Section (section 13-18)',NULL,'in_progress','independent_task','Excellent attitude, effort, and respect! · ✏️ Free Choice Writing (4 Stars)',5,'Ryan - (Recommendation To Do List)',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-23','16:00','18:00','Exam - 47 Section (section 18-20)',NULL,'in_progress','independent_task','Excellent attitude, effort, and respect! · ✏️ Free Choice Writing (4 Stars)',5,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-25','16:00','18:00','Topic Sentence - Review',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🗓️ Skip Homework (5 Stars)',4,'📋 Start of Topic Sentence Workbook',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-27','15:00','17:00','Topic Sentence - Topic + Controlling Idea = Topic Sentence',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'Topic Sentence','Private Mentorship - Ryans English Class 2025-04-27 (PDF)',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-04-30','16:00','18:00','Sentence Variety + More',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! Watch how you speak to adults. · 🎉 Verbal Praise (3 Stars)',3,'April 30 2025','April 30 2025 - Sentence Variety Homework',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-02','16:00','18:30','Topic Sentence BUBBLE (Main Idea + Supporting Detail)',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,NULL,NULL,NULL,NULL,'May 2 2025 (Topic Sentence) Main Idea + Supporting Detail',NULL,'https://www.youtube.com/watch?v=E1_WBCGfho8&t=202s',NULL,NULL),
('2025-05-04','15:00','17:20','TEEC - Transition Words / Adding Detail',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'Using TEEC and Transitions to Build Amazing Paragraphs',NULL,'📚 Ryan''s TEEC Writing Homework',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-07','16:00','18:00','Essay Practice',NULL,NULL,'life_skills_task','Excellent attitude, effort, but please don''t swear at your mother! · 💪🏻 Keep Trying (1-2 Stars)',1,'📝 Ryan''s Persuasive Essay Assignment',NULL,'May 7 2025 Finish for homework -- starting on Paragraph 4',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-11','16:00','18:25','Thesis Statement + Background + The Hook',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! Keep eyes on the screen and focus · 🖍️ Creative Activity Time (4 Stars)',4,'What Is a Thesis Statement',NULL,'Thesis Statement + Background + The Hook','📝 Ryan''s Homework – Parallel Structure, Writing, and Organization Practice',NULL,NULL,NULL,NULL,NULL),
('2025-05-14','16:00','19:00','Background + Essay',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'📝 Ryan''s Full-Day Essay Project','Essay layout',NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-16','16:00','18:00','Compare & Contrast + Background',NULL,NULL,'life_skills_task','Excellent attitude, effort, and respect! · 🖍️ Creative Activity Time (4 Stars)',4,'🧠 Ryan''s Special Lesson: How to Compare and Contrast in Writing','📝 Ryan''s Essay Feedback','Ryan_Compare_and_Contrast_Practice.docx',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-18','16:00','18:00','Essay (1-2-3) Paragraph',NULL,'in_progress','life_skills_task',NULL,NULL,'May 18 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-21','16:00','18:50','Essay Template Structure',NULL,'in_progress','life_skills_task',NULL,NULL,'May 21 2025 (Essay Template)',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-23','16:00','18:00','Essay Template Structure + Erasing Topic Sentence and re-writing it',NULL,'in_progress','life_skills_task',NULL,NULL,'🧠 Essay Mapping Warm-Up Task for Ryan',NULL,NULL,NULL,NULL,NULL,'https://www.youtube.com/watch?v=aTmCWLIA0K8',NULL,NULL),
('2025-05-25','16:00','18:00','Paraphrasing + Synonyms + Sentence Starters',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'Essay_Writing_Paragraph:Sentence-Starter_Structure_TEET.pdf','📝 Lesson: Introduction to Paraphrasing','📝 Lesson: Introduction to Synonyms',NULL,NULL,NULL,'https://www.youtube.com/watch?v=0mF0mFwlnAY',NULL,NULL),
('2025-05-28','16:00','18:00','Paraphrasing (5) Sentence + (2) Paragraphs',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect!',4,'Private Mentorship - Ryans English Class 2025-05-28 (PDF)',NULL,'📘 Warm-Up: Paraphrasing Practice (Review from Last Class)',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-30','16:00','18:00','Paraphrasing Booklet',NULL,'in_progress','life_skills_task',NULL,NULL,'Ryan_Paraphrasing_Master_Homework.pdf',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-05-30','18:30','20:30','Started: Paraphrasing Booklet',NULL,'in_progress','life_skills_task','🌟 Special Outing (5 Stars)',5,'📘 Paraphrasing Booklet – Ryan',NULL,NULL,NULL,NULL,NULL,'https://www.youtube.com/watch?v=SObGEcok06U',NULL,NULL),
('2025-06-01','16:00','18:20','Essay Writing',NULL,'in_progress','life_skills_task',NULL,NULL,'✍️ Essay Writing Task: Using Quotes and Paraphrasing from Research',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-04','16:00','18:00','Continuation - Essay Writing',NULL,'in_progress','life_skills_task','Excellent attitude, effort, and respect! · 🌟 Special Outing (5 Stars)',5,'✍️ Essay Writing Task: Using Quotes and Paraphrasing from Research',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-06','16:00','18:00','Paraphrasing + English Terminology',NULL,NULL,'life_skills_task',NULL,NULL,'Paraphrasing June 6 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-08','16:00','18:00','"The Lazy Boy" English Terminology + Assignment',NULL,NULL,'life_skills_task',NULL,NULL,'🎓 Part 1: Watch and Observe',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-11','16:00','18:25','"Jack & The Beanstalk" + Plot Diagram + Paragraph Writing',NULL,'in_progress','life_skills_task','🌟 Special Outing (5 Stars)',5,'📝 Jack and the Beanstalk – Story Structure + Writing Assignment',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-15','16:00','18:00','"Jack & The Beanstalk" Essay',NULL,'in_progress','life_skills_task',NULL,NULL,'🎬 Jack and the Beanstalk Essay Assignment for Ryan',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-20','16:00','18:00','Quoting #1',NULL,'in_progress','life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-22','16:00','18:17','Quoting #2',NULL,'in_progress','life_skills_task',NULL,NULL,'📝 Quotation Marks Quiz – For Ryan','✓ Answer Key – Quotation Marks Quiz','Homework June 22 2025',NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-25','16:10','18:00','Quoting #3 [Brackets]',NULL,NULL,'life_skills_task',NULL,NULL,'🎯 Lesson Title: How to Change or Add Words Inside a Quote',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-06-29','16:00','17:00','Parentheses & Brackets',NULL,'in_progress','life_skills_task',NULL,NULL,'📝 Brackets Practice – Ryans Worksheet',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-05','16:30','18:30','First Day Back: Developing Ideas',NULL,'in_progress','life_skills_task',NULL,NULL,'Essay Writing Sept 5 2025',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-07','09:30','11:30','Compare & Contrast Sentences',NULL,'in_progress','life_skills_task',NULL,NULL,'📘 Homework Workbook: Before & After Writing Practice','Compare, Contrast, Combined Sentences',NULL,NULL,NULL,NULL,'https://www.youtube.com/watch?v=SBTldiZu8Sc',NULL,NULL),
('2025-09-12','16:30','18:30','Compare & Contrast Sentences / School Homework Help',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-14','09:30','11:30','Point By Point / Block Essay',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-15','16:30','18:30','Block Essay',NULL,NULL,'life_skills_task',NULL,NULL,'Ryan''s Block Essay Homework',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-21','09:30','11:30','Point By Point',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'September 21 2025 Compare & Contrast','Homework – Compare & Contrast Paragraphs',NULL,NULL,NULL,NULL),
('2025-09-26','16:10','18:25','Point By Point',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-09-28','09:30','11:30','Point By Point (paragraph 1 almost finished)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-01','16:00','18:00','Mathematics',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-04','15:30','17:30','Point By Point - transition sentence',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-15','16:30','18:30','Background information',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-19','09:30','11:30','Background information (Specific VS Non-Specific) (Introduction VS Body Paragraphs)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🧠 Ryan''s Homework: Building Strong Introductions and Thesis Statements',NULL,NULL,NULL,NULL,NULL),
('2025-10-19','16:30','18:30','Math / Background information',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-10-29','16:30','18:30','Tense Review',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-02','09:30','11:30','Past Continuous VS Past Perfect Continuous',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Tense Package - Ryan Roe',NULL,NULL,NULL,NULL,NULL),
('2025-11-05','17:00','19:00','Paragraph Writing',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-11-09','09:30','11:30','Oral Communication Using Tenses',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Ryan''s Grammar Mastery Writing Project',NULL,NULL,NULL,NULL,NULL),
('2025-11-12','16:30','18:30','Speaking Exercises & Sentence Building',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🗣️ Ryan''s Speaking Warm-Up: Past • Present • Future',NULL,NULL,NULL,NULL,NULL),
('2025-11-16','09:30','11:30',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Ryans Condition Practice','Sentence Building 2025',NULL,NULL,NULL,NULL),
('2025-11-23','09:30','11:30','Sentence Writing: (Compound: Object, Predicate, Sentence) + Tense Focus',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'📘 RYAN – ADVANCED GRAMMAR & SENTENCE STRUCTURE WORKBOOK',NULL,NULL,NULL,NULL,NULL),
('2025-11-26','09:30','11:30',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'November 26 2025: Total: 100 Questions',NULL,NULL,NULL,NULL,NULL),
('2025-11-30','09:30','11:30','Application Writing Assignment: 3 Body Paragraph (draft 1)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'November 30 2025 - Application Writing Assignment (rough draft)',NULL,NULL,NULL,NULL,NULL),
('2025-12-07','09:30','11:30','Application Writing Assignment: 3 Body Paragraph (draft 2)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'November 30 2025 - Application Writing Assignment (rough draft)',NULL,NULL,NULL,NULL,NULL),
('2025-12-10','16:30','18:30','Lack of motivation day',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2025-12-14','09:30','11:30','Application Writing Assignment: 3 Body Paragraph (draft 2)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'November 30 2025 - Application Writing Assignment (rough draft)',NULL,NULL,NULL,NULL,NULL),
('2025-12-21','09:30','11:30','Breaking Down Sentences in Paragraphs (Homework Assigned)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'November 30 2025 - Application Writing Assignment (rough draft)',NULL,NULL,NULL,NULL,NULL),
('2026-01-07','16:30','18:30','Identifying Clauses, Sentence Structure, Compound Tools',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'PART 1 — SHORT LESSON (READ TOGETHER)',NULL,NULL,NULL,NULL,NULL),
('2026-01-14','16:30','18:30','Advanced Clause Identification',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Ryan -- Advanced Grammar',NULL,NULL,NULL,NULL,NULL),
('2026-01-18','09:30','11:30',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Ryan Sentence Mastery → Paragraph Control Workbook','Advanced Grammar #2: CORE RULE',NULL,NULL,NULL,NULL),
('2026-01-21','16:30','18:30',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Ryan Sentence Mastery → Paragraph Control Workbook',NULL,NULL,NULL,NULL,NULL),
('2026-01-25','09:30','11:30','Social Studies: Levels of Government',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-01-28','16:00','18:00',NULL,NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-01','09:30','11:30','Sentence Variety: Compound Sentences',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'What is a conjunctive adverb',NULL,NULL,NULL,NULL,NULL),
('2026-02-04','16:30','18:30','Sentence Variety: Complex Sentences',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Sentence Variety: Complex Sentences',NULL,NULL,NULL,NULL,NULL),
('2026-02-08','09:30','11:30','Sentence Variety: Complex Sentences (Re-writing Sentences)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-11','16:30','18:30','Lactose vs Lactose Free - Reading and Identifying Sentences',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-15','09:30','11:30','Polynomials',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-18','16:30','17:30','Conversion Factors & Units of Measurement Discussion',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-22','09:30','11:30','Unit of Measurements & Conversion Factors: Years to Seconds + Introduction to Stoichiometry',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-02-25','09:30','11:30','Unit of Measurements & Conversion Factors: G to KG, Micrometers, Nanometers',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'Untitled document',NULL,NULL,'https://www.youtube.com/watch?v=Jh9pFp1oM7E&t=3s',NULL,NULL),
('2026-03-01','09:30','11:30','Scientific Notation',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🔵 LESSON 1: SCIENTIFIC NOTATION',NULL,NULL,'https://www.youtube.com/watch?v=bXkewQ7WEdI',NULL,NULL),
('2026-03-04','16:30','18:30','Multiplying, Dividing, Adding & Subtracting Scientific Notation',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🔵 SCIENTIFIC NOTATION — PRACTICE AND APPLICATION',NULL,NULL,NULL,NULL,NULL),
('2026-03-08','09:30','11:30','Significant Figures (overview) + some calculations',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🔵 LESSON: SIGNIFICANT FIGURES',NULL,NULL,'https://www.youtube.com/watch?v=gtwyWKnnm_I',NULL,NULL),
('2026-03-11','16:30','18:30','Significant Figures - Focusing On Calculation',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'SIGNIFICANT FIGURES IN CALCULATIONS',NULL,NULL,'https://chem.libretexts.org/Courses/Modesto_Junior_College/Chemistry_142%3A_Pre-General_Chemistry_(Brzezinski)/CHEM_142%3A_Text_(Brzezinski)/02%3A_Numbers_and_Measurement/2.02%3A_Significant_Figures_in_Calculations/2.2.01%3A_New_Page',NULL,NULL),
('2026-03-15','16:30','18:30','Significant Figures - Focusing On Calculation',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-03-29','09:30','11:30','Adding Sentences to Paragraph',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-01','16:30','18:30','HOW TO DEVELOP IDEAS',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🧠 LESSON: HOW TO DEVELOP IDEAS + USE SIMILES & METAPHORS',NULL,NULL,NULL,NULL,NULL),
('2026-04-05','09:30','11:30','Literary Word: Alliteration, Repetition, Metaphors, Similes, Personification',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'📚 LESSON: POETRY TOOLS + HOW A POEM BUILDS A STORY',NULL,NULL,NULL,NULL,NULL),
('2026-04-12','09:30','11:30','Literary Device',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-15','16:30','18:30','Literary Device (walking-running-biking path VS trails and paragraph writing)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-19','09:30','11:30','Trigonometry pathagon theorem',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-04-22','16:30','18:30','Chemistry (Atoms)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🧪 CHEMISTRY STUDY SHEET (RYAN)',NULL,NULL,NULL,NULL,NULL),
('2026-05-03','09:30','11:30','Chemistry (Atoms)(Molecules)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-06','16:30','18:30','Math: SA of Cylinder + Chemistry (Atoms)(Molecules)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL),
('2026-05-10','09:30','11:30','Physical & Chemical Properties',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,'🧪 PHYSICAL & CHEMICAL PROPERTIES','Formula Sheets',NULL,NULL,NULL,NULL),
('2026-05-13','16:30','18:30','Physical & Chemical Properties (In-depth)',NULL,NULL,'life_skills_task',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);

-- Insert appointments (kind detection: Wed 16:30 + Sun 09:30 = reserved per pattern)
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
  SELECT id INTO v_client_id FROM public.clients WHERE full_name = 'Ryan Roe' LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Ryan Roe not found. Run Phase 15c-Foundation first.';
  END IF;
  FOR r IN SELECT * FROM _ryan_sessions ORDER BY session_date, start_time LOOP
    SELECT id INTO v_contract_id
      FROM public.contracts
      WHERE client_id = v_client_id
        AND start_at <= (r.session_date::text || ' ' || r.start_time::text)::timestamp AT TIME ZONE v_tz
        AND end_at   >= (r.session_date::text || ' ' || r.end_time::text)::timestamp AT TIME ZONE v_tz
      LIMIT 1;
    v_duration := GREATEST(15, EXTRACT(EPOCH FROM (r.end_time - r.start_time))::int / 60);
    v_dow := EXTRACT(DOW FROM r.session_date);
    v_kind := CASE
      WHEN v_dow = 3 AND r.start_time = TIME '16:30:00' THEN 'reserved'
      WHEN v_dow = 0 AND r.start_time = TIME '09:30:00' THEN 'reserved'
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

-- Insert hours_ledger rows
INSERT INTO public.hours_ledger
  (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
SELECT
  a.client_id, a.contract_id, a.id, -a.duration_minutes, 'session_completed',
  jsonb_build_object('source','phase-15c-ryan-backfill', 'kind','backfilled_from_manual_tracker',
                     'session_date', (a.starts_at AT TIME ZONE 'America/Vancouver')::date),
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'
FROM public.appointments a
JOIN public.clients c ON c.id = a.client_id
WHERE c.full_name = 'Ryan Roe' AND a.status = 'completed';

-- Insert lesson_logs (JOIN by date+start_time so duplicate-date rows map to correct appointment)
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
FROM _ryan_sessions s
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Ryan Roe' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = s.session_date
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::time = s.start_time
WHERE NOT EXISTS (SELECT 1 FROM public.session_lesson_logs l WHERE l.appointment_id = a.id);

-- Insert files/URLs
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
FROM _ryan_sessions s
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Ryan Roe' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = s.session_date
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::time = s.start_time
JOIN public.session_lesson_logs l ON l.appointment_id = a.id
JOIN LATERAL (VALUES
  ('file', s.f1), ('file', s.f2), ('file', s.f3),
  ('file', s.f4), ('file', s.f5), ('file', s.f6),
  ('url',  s.url1), ('url',  s.url2)
) x(kind, value) ON x.value IS NOT NULL;

-- Verify
SELECT
  (SELECT COUNT(*) FROM _ryan_sessions) AS source_rows,
  (SELECT COUNT(*) FROM public.appointments a JOIN public.clients c ON c.id = a.client_id WHERE c.full_name = 'Ryan Roe') AS appointments,
  (SELECT COUNT(*) FROM public.hours_ledger l JOIN public.clients c ON c.id = l.client_id WHERE c.full_name = 'Ryan Roe') AS ledger_rows,
  (SELECT COUNT(*) FROM public.session_lesson_logs ll JOIN public.clients c ON c.id = ll.client_id WHERE c.full_name = 'Ryan Roe') AS lesson_logs,
  (SELECT COUNT(*) FROM public.session_lesson_files f
    JOIN public.session_lesson_logs ll ON ll.id = f.lesson_log_id
    JOIN public.clients c ON c.id = ll.client_id WHERE c.full_name = 'Ryan Roe') AS files;

COMMIT;
