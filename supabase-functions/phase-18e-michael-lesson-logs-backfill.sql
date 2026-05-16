-- ─────────────────────────────────────────────────────────────────────────
-- Phase 18e: Backfill Michael's ~145 historical lesson logs
-- ─────────────────────────────────────────────────────────────────────────
-- One lesson_log per session for Jan 2025 → May 2026. All signed by Caleb.
-- Files preserved as legacy placeholders (no actual blob — original files
-- live in owner's Google Drive). URLs preserved as proper kind='url' rows.
--
-- STRATEGY:
--   1. Build a TEMP TABLE with every lesson row from the owner's manual log
--   2. For each row, ensure an appointment exists on that date
--      (create a complimentary admin_override appointment if missing)
--   3. INSERT lesson_logs joining temp table → appointments by date
--   4. INSERT lesson_files for each file/URL reference
--
-- All wrapped in a transaction. Safe to run once. To re-run, first DELETE
-- session_lesson_logs WHERE meta source matches this import.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── Build the temp table of every lesson row ───────────────────────────
CREATE TEMP TABLE _michael_lesson_rows (
  session_date date,
  start_time time, end_time time,
  focus_area text, key_concepts text,
  status_label text, type_label text,
  feedback text, rating int,
  file_1_name text, file_2_name text, file_3_name text,
  url_1 text, url_2 text
) ON COMMIT DROP;

INSERT INTO _michael_lesson_rows VALUES
-- 2025
('2025-01-01', NULL, NULL, 'Socialization & Communication (tester prompt)', NULL, 'engaging', 'social_engagement', 'Great work!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-03-25', '11:00', '14:00', 'Michael''s First Day Back After A 2 Month Trip To China', NULL, 'engaging', 'gym_session', 'Welcome back & Great work today Michael!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-02', '11:00', '14:00', 'Gym Session - Back After Healing', NULL, 'engaging', 'gym_session', 'Great work today Michael!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-03', '11:00', '14:00', 'Regular Gym Session', NULL, 'engaging', 'gym_session', 'Great work today Michael!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-08', '11:00', '14:00', 'Regular Gym Session', NULL, 'low_energy', 'setback_occurred', 'Needs Improvement', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-09', '11:00', '14:00', 'Regular Gym Session / Michael Was Late', NULL, 'engaging', 'maintaining_progress', 'Great work today Michael!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-15', '11:00', '14:00', 'Regular Gym Session', NULL, 'engaging', 'gym_session', 'Great work today Michael!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-04-22', '11:00', '14:00', 'Regular Gym Session', NULL, 'low_effort', 'gym_session', 'Great work today Michael!', 5, 'Michael April 22 2025', NULL, NULL, NULL, NULL),
('2025-04-24', '11:00', '14:00', 'Regular Gym Session + Discussion With Daniel: Money Transfer, Job Search, Phone Call: SunGiven', NULL, 'low_effort', 'revisiting_goals', 'Great work today But stop Being Late!', 3, NULL, NULL, NULL, NULL, NULL),
('2025-04-30', '11:00', '14:00', 'Prioritization Discussion + Job Search + Regular Gym Session', NULL, 'in_progress', 'social_engagement', 'Great work today But stop Being Late!', 5, 'Michael''s Online Behavior & Productivity Tracker', '(Yang) Calendar & Lesson Tracker', NULL, NULL, NULL),
('2025-05-01', '11:00', '14:00', 'Another Prioritization Conversation + Job Search + Regular Gym Session + Resume', NULL, 'in_progress', 'life_skills_task', 'Great work today But stop Being Late!', 5, NULL, NULL, NULL, NULL, NULL),
('2025-05-04', '11:00', '12:00', 'Caleb worked on Michael''s Resume & Cover Letter', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-05-05', '09:00', '10:00', 'Caleb Spoke W/Michael''s Manager', NULL, NULL, NULL, NULL, 0, 'Update from Michael''s Manager – Summary of Phone Call', NULL, NULL, NULL, NULL),
('2025-05-08', '09:30', '14:00', 'T&T Job Search | Introduction To New House', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'Michael''s Job Search Information', 'Job Search + Resume & Cover Letter', 'May 8 2025: Job Search Report', NULL, NULL),
('2025-05-13', '09:30', '14:00', 'Back In Motion (Warehouse Program) + Starbucks + Indeed + Craigslist', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 13 2025 - Job Search', 'YVR Disabilities', NULL, NULL, NULL),
('2025-05-14', '09:30', '14:00', 'Back In Motion (Intake Form) + UPS + YVR + More', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 14 2025 Job Search Information', NULL, NULL, NULL, NULL),
('2025-05-15', '11:00', '14:00', 'T&T Call back + Walmart + BestBuy + McDonalds', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 15 2025 Job Search Information', NULL, NULL, NULL, NULL),
('2025-05-20', '11:00', '14:00', 'Home Depot & More', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 20 2025 Job Search Record', 'Hey Daniel and Linda - Jobs West Employment Services', NULL, NULL, NULL),
('2025-05-21', '11:00', '14:00', 'Job Plan + Intake CLBC + IGA & more', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 21 2025 Job Search Record', 'Hey Daniel and Linda - Jobs West Employment Services', NULL, NULL, NULL),
('2025-05-22', '11:00', '14:00', 'Back in Motion Interview Preparation', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'Michael_Intake_Interview_Preparation_Guide_BackInMotion.docx', NULL, NULL, NULL, NULL),
('2025-05-23', '09:00', '11:30', 'Back in Motion Interview Day', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Back in Motion Interview Report – Michael Yang', 'Back in Motion 面试报告 – Michael Yang', NULL, 'https://backinmotionhealth.com/locations/richmond/', NULL),
('2025-05-27', NULL, NULL, 'Michael was apparently sick, Caleb offered to continue working from home & Linda refused.', NULL, 'needs_improvement', 'repeated_setback', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-05-28', NULL, NULL, 'Michael was apparently sick but went to the bank with father to continue the PWD application assignments', NULL, 'needs_improvement', 'repeated_setback', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-05-29', '11:00', '14:00', 'Bank Profile (CIBC) + CLBC Inquiry + The Ministry of Social Development Update', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'May 29 2025 (Submitted Social Assistance Documents/Final Decision)', 'May 29 2025 - Daily Tasks', NULL, NULL, NULL),
('2025-06-02', '11:00', '13:00', 'Back In Motion (consent forms) + CLBC (Financial Funding Conversation with Diane)', NULL, 'in_progress', 'life_skills_task', NULL, 5, 'June 2 2025 (Back In Motion) (CLBC)', '📋 Michael 每日汇报 – 2025年6月2日', NULL, NULL, NULL),
('2025-06-04', '11:00', '14:00', 'Transit Guidance & Information', NULL, 'in_progress', 'life_skills_task', NULL, 5, '📋 Daily Report – June 4th, 2025', NULL, NULL, NULL, NULL),
('2025-06-05', '11:00', '14:00', 'Change of Schedule + Email Aneil + Contact Dianne (CLBC) + Talked with Michael about Soft & Hard Skills', NULL, 'in_progress', 'life_skills_task', NULL, 5, '📅 Michael 的课程和导师安排表', 'June 5th 2025', NULL, NULL, NULL),
('2025-06-10', '10:00', '13:00', 'Back In Motion - In Class Support', NULL, 'in_progress', 'life_skills_task', NULL, 2, 'PRIVATE MENTORSHIP – CLASS OBSERVATION REPORT', NULL, NULL, NULL, NULL),
('2025-06-11', '13:00', '16:00', 'Researched CDB (Apply in a few weeks) CIBC BANK STATEMENT + Shelter Form Completed + Contacted London Drugs Supervisor', 'Michael needs to cancel fit4less membership', 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-06-12', '13:00', '16:00', 'The Ministry''s Office Visit + London Drugs (pay stub)', NULL, 'in_progress', 'life_skills_task', NULL, 5, NULL, NULL, NULL, NULL, NULL),
('2025-06-16', '13:30', '16:30', 'Meeting with Diane (CLBC) + Pick Michael up after Back In Motion''s Class', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-06-17', '09:30', '12:30', 'MS Team 365 (Preparation For Online Classes)', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Back In Motion Report (Week 2) – June 17 2025', NULL, NULL, NULL, NULL),
('2025-06-19', '09:30', '12:30', 'MS Docs Training', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'June 19 2025 - Daily Report', NULL, NULL, NULL, NULL),
('2025-06-24', '09:30', '12:30', 'Teamwork & Order Picking', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'June 24 2025 — Order Picking', NULL, NULL, NULL, NULL),
('2025-06-25', '09:30', '14:00', 'Numeracy', 'Michael stayed later - Match Support (TIHI)', 'in_progress', 'life_skills_task', NULL, 0, 'Tihi - Numeracy', 'Warehouse_Math_Practice_Michael.pdf', NULL, NULL, NULL),
('2025-06-26', '09:30', '12:30', 'Packaging Slips & Shipping Slips', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-06-30', '09:30', '12:30', 'Certificate Day', NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-07-02', '09:30', '12:30', 'Certificate Day (Completed/Passed)', NULL, 'engaging', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-07-04', '09:00', '11:30', 'Receiving Procedure (Warehouse Training). Michael was late — should have arrived at 8:30am, arrived at 9am', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Incident Report/Scheduling/Timeline & Disruption Summary', NULL, NULL, NULL, NULL),
('2025-07-07', '09:00', '12:30', 'Order Picking', NULL, 'in_progress', 'life_skills_task', NULL, 0, '📦 Order Picking', NULL, NULL, NULL, NULL),
('2025-07-09', '09:30', '12:30', 'Certificate Day', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Notes: Lock-Out Tag-Out', NULL, NULL, NULL, NULL),
('2025-07-12', '10:30', '13:30', 'Ladder Certificate Training', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Michael Ladder Training', 'Michael - Ladder Information', NULL, NULL, NULL),
('2025-07-14', '08:50', '11:50', 'Online Class - Caleb''s Place', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-07-16', '09:30', '12:30', 'Certificate Day', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-07-18', '11:00', '14:00', 'General Life skills Conversation', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-07-21', '08:40', '11:40', 'Signed Gov Documents + Packaging', NULL, 'in_progress', 'life_skills_task', NULL, 0, '📦 仓库打包流程（给Michael 学习）', NULL, NULL, NULL, NULL),
('2025-07-23', '08:40', '11:40', 'Inventory Procedures in the Warehouse', NULL, 'in_progress', 'life_skills_task', NULL, 0, '📦 Inventory Procedures in the Warehouse', '📘 Forklift, Boom Lift & Scissor Lift Certification Study Guide', NULL, NULL, NULL),
('2025-07-25', '11:00', '14:00', 'Interview Roleplay + WHMIS Training for Certificate', NULL, 'in_progress', 'life_skills_task', NULL, 0, '📘 WHMIS 工作場所危害物質資訊系統認證培訓手冊', '📘 急救與 CPR 培訓指南（初階認證）', NULL, NULL, NULL),
('2025-07-28', '08:30', '11:30', 'First Aid Certificate', NULL, 'completed', 'life_skills_task', NULL, 0, 'First Aid Certificate.pdf', NULL, NULL, NULL, NULL),
('2025-07-30', '09:30', '12:30', 'WHMIS Certificate', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Hazardous groups', NULL, NULL, NULL, NULL),
('2025-08-01', NULL, NULL, 'Michael''s PWD Application — Accepted', NULL, 'completed', 'independent_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-08-05', '15:00', '18:00', 'Forklift Training', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'FORKLIFT (Module 1)', 'True North - Class 1,4,5 Forklift training program 2.pdf', NULL, NULL, NULL),
('2025-08-06', '09:06', '16:06', 'Fall Protection Certificate (True North Burnaby)', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'True North – Fall Protection', NULL, NULL, NULL, NULL),
('2025-08-07', '08:55', '15:30', 'Forklift Certificate', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'True North - Forklift Training Day', NULL, NULL, NULL, NULL),
('2025-08-08', '09:00', '18:00', 'Last Day (True North): Boom & Scissor Lift Certificate', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'True North – Boom & Scissor Lift', NULL, NULL, NULL, NULL),
('2025-08-11', '13:30', '15:00', 'Last Day: Back In Motion - Graduation', NULL, 'completed', 'independent_task', NULL, 0, 'Certificate (Hard Copies)', NULL, NULL, NULL, NULL),
('2025-08-12', '11:00', '14:00', '1st Rental Payment (2 Service Requests) & Taught Michael how to report his income', NULL, NULL, 'life_skills_task', NULL, 0, 'August 12 2025 - Daily Report', 'Reporting Income Instructions (报告收入说明)', NULL, NULL, NULL),
('2025-08-15', '15:00', '17:30', NULL, NULL, NULL, 'life_skills_task', NULL, 0, 'Reporting Income (template)', 'MichaelSelfReportingSimulator.html', NULL, NULL, NULL),
('2025-08-20', '09:00', '12:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, 'August 20 2025 - Daily Report', NULL, NULL, NULL, NULL),
('2025-08-21', '11:30', '14:30', 'Government Office For Nutrition & Dietary + Job Search', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Michael_Yang_Cover_Letter.pdf', 'Michael_Yang_Resume_Updated.pdf', NULL, NULL, NULL),
('2025-08-22', '11:00', '14:00', 'Job Search', NULL, 'in_progress', 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-09', '09:30', '12:30', 'Follow Up: Earls, T&T, London Drugs, Dianne Carney (Jobs West), Self Reporting', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Daily Report: September 9 2025', NULL, NULL, NULL, NULL),
('2025-09-10', '09:30', '12:30', 'Job Search', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-11', '09:30', '11:30', 'Job Search', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-16', '09:30', '12:30', 'Job Search | Life skills Training (Interview Preparation) | Drive To Back In Motion For Certificates', NULL, 'in_progress', 'life_skills_task', NULL, 0, 'Interview Preparation', NULL, NULL, NULL, NULL),
('2025-09-18', '09:30', '12:30', 'Job Search', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-19', '09:30', '12:30', 'Job Search (London Drugs Richmond)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-23', '09:30', '12:30', 'Job Search / Contact Dianne / Jobs West', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-09-24', '09:30', '12:30', 'Monthly Reporting / Job Search / Gym', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report: September 24 2025', NULL, NULL, NULL, NULL),
('2025-09-25', '09:30', '12:30', 'Volunteer Position / Gym', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report: September 25 2025', NULL, NULL, NULL, NULL),
('2025-09-30', '09:30', '12:30', 'Volunteer Position', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report: Volunteering Search', NULL, NULL, NULL, NULL),
('2025-10-01', '09:30', '12:30', 'Kidney Education / Vitamin Test / Employment Call-Back', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-10-02', '09:30', '12:30', 'Volunteer Search', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-10-07', '09:30', '12:30', 'Volunteer Search', NULL, NULL, 'life_skills_task', NULL, 0, 'Michael Yang — Volunteer & Employment Interest Questionnaire', 'Honest Reality Check (meant kindly, but firm) 真实情况说明（善意但直接）', NULL, NULL, NULL),
('2025-10-09', '09:30', '12:30', 'In Person Job Search + Gym', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily report: October 9 2025', NULL, NULL, NULL, NULL),
('2025-10-16', '09:30', '12:30', 'Follow Up: Price Mart', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-10-17', '09:30', '12:50', 'Staples (print resumes) / Drop off Resumes (Price Smart, Big Way Hotpot, Yaohan) / Gym', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily report: October 17 2025', NULL, NULL, NULL, NULL),
('2025-10-21', '09:30', '12:30', 'London Drugs & Inappropriate Behaviour', NULL, NULL, 'life_skills_task', NULL, 0, 'Conflict Report: October 21 2025', 'Report: Sexualization', NULL, NULL, NULL),
('2025-10-22', '09:30', '12:30', 'Contact CLBC & Jobs West', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report: October 22, 2025', NULL, NULL, NULL, NULL),
('2025-10-28', '09:30', '12:30', 'Problem Solving Exercises', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-10-29', '09:30', '12:30', 'Problem Solving Exercises', NULL, NULL, 'life_skills_task', NULL, 0, '🧠 Michael''s Problem-Defining Practice Workbook (Advanced Version)', NULL, NULL, NULL, NULL),
('2025-10-30', '09:30', '12:30', 'Problem Solving Exercises', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-04', '09:30', '12:30', 'London Drugs: Incident', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-05', '09:30', '12:30', 'Neuropsychological Assessment Search', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report – Michael (Assessment Coordination Update)', NULL, NULL, NULL, NULL),
('2025-11-06', '09:30', '12:30', 'Contacted WorkBC, BC Centre for Ability, Vancouver Health Authority', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-11', '10:30', '12:30', 'Life Skills', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-12', '13:00', '15:00', 'WorkBC (First Appointments)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-19', '09:30', '12:30', 'myBooklet', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-25', '09:30', '12:30', 'myBooklet + Programmed Michael''s Calendar + Monthly Reporting', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-26', '09:30', '12:30', 'Back In Motion - Received Call for therapy + myBooklet', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2025-11-27', '09:30', '12:30', 'myBooklet + Gym', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
-- 2026
('2026-01-06', '10:00', '13:00', 'Making Responsible Payments - Payee Payments', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-01-07', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, 'Test (Payees & Bill Payments)', 'Phone Bill Identification & Payee Practice', 'PAYEE SEARCH MISSION — REAL CANADIAN COMPANIES', NULL, NULL),
('2026-01-08', '10:00', '13:00', 'Life Simulator (Modules)', NULL, NULL, 'life_skills_task', NULL, 0, 'MODULE 1 — SURVIVAL MODE', NULL, NULL, NULL, NULL),
('2026-01-13', '10:00', '13:00', 'Life Simulator (Modules)', NULL, NULL, 'life_skills_task', NULL, 0, 'MODULE 2 — FUNCTIONAL ADULT MODE', NULL, NULL, NULL, NULL),
('2026-01-15', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, 'MODULE 3 — LONG-TERM ADULT MODE', NULL, NULL, NULL, NULL),
('2026-01-16', '10:00', '13:00', 'Study & Practice New Gym Exercises (shared YouTube playlist with Michael)', NULL, NULL, 'gym_session', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-01-20', '10:00', '13:00', NULL, NULL, NULL, 'gym_session', NULL, 0, 'Michael Workout Plan & Gym Checklist', 'Michael Yang - Workout Plan', 'GYM PERFORMANCE TRACKER', NULL, NULL),
('2026-01-21', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, 'Grocery Store: Safety Test', 'Bacteria Infections and Diseases Testing', NULL, 'https://youtu.be/I3Bu4VpgK_w?si=cqs7HT9b3I5K5-7B', 'https://www.youtube.com/watch?v=Wmrlpa1XyMI&t=95s'),
('2026-01-23', '08:10', '11:10', 'Back In Motion: Psychological & Physiological Assessment (WorkBC Funded)', NULL, NULL, 'life_skills_task', NULL, 0, 'Back In Motion: Physiotherapy', NULL, NULL, NULL, NULL),
('2026-01-27', '10:00', '13:00', 'Community Centre: Signed up for volunteering at Kerrisdale and Dunbar & collected pamphlets for programs', NULL, NULL, 'life_skills_task', NULL, 0, 'Daily Report – Community Centre Outreach (Dunbar & Kerrisdale)', NULL, NULL, NULL, NULL),
('2026-01-29', '10:00', '13:00', 'Life skills + Gym Session', NULL, NULL, 'gym_session', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-01-30', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-03', '10:00', '13:00', 'Nutrition and Food Education', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-04', '10:00', '13:00', 'Nutrition and Food Education Continuation + Gym', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-06', '10:45', '13:45', 'Jobs West (Leanne) Cancelled Appointment 20 Minutes Before + Gym Session', NULL, NULL, 'gym_session', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-10', '10:00', '13:00', 'Registered For Yoga Class + Gym Session', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-12', '10:00', '12:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-13', '10:00', '13:00', 'Applying For Special Needs Volunteering Opportunities', NULL, NULL, 'life_skills_task', NULL, 0, 'Sheryl Newman, Volunteer Management Coordinator', NULL, NULL, NULL, NULL),
('2026-02-17', '10:00', '13:00', 'Applying For Special Needs Volunteering Opportunities', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-18', '13:00', '17:30', 'Michael''s First Yoga Class. Behavioural Therapist Referral Form Completed', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-19', '10:00', '13:20', 'Activity Registration-Search / Create Ad Looking for Badminton Instructor / Emailed Heather at SCI / Meeting with Sheryl Norman', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-24', '10:00', '13:00', 'Badminton — 1 Free Trial Session / Register For Sports', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-02-25', '10:00', '13:00', 'Cristiano Conversation', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-02', '13:00', '16:00', 'Badminton Free Trial Session (Eagle Club)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-03', '10:00', '13:00', 'Sports Check (Michael bought a new racket & birdies)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-05', '09:30', '12:30', 'Jobs West Meeting (Leanne)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-10', '10:00', '13:00', 'Inquire About Strikewell Boxing Waiver & Online Form', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-12', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-13', '08:30', '09:30', 'Kerrisdale Community Centre Volunteer Meeting W/Meeka', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-17', '10:00', '13:00', 'Disability Foundation Orientation', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-18', '10:00', '13:00', 'Disability Foundation Orientation (continued)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-19', '10:00', '11:00', 'Disability Foundation & other tasks', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-21', '10:00', '12:00', 'Disability Foundation Orientation Video Finished. Emailed Sheryl & Setup Meeting', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-24', '10:00', '13:00', 'Follow-up Meeting with Sheryl / Started Special Olympic Application', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-25', '10:00', '13:00', 'BC Service Card Setup on Michael''s Phone (Interview with BC Government Agent) + Downloaded BC Wallet + Criminal Record Check Paid & Completed + Monthly Reporting + Updated Address on Identification Card', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-26', '10:00', '13:00', 'Special Olympics Registration Form', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-03-31', '10:00', '13:00', 'Emailed Tony Lee at WorkBC for Next Steps, Emailed Meagen from Back In Motion re: physiotherapy assessment, Emailed Louise Utting re: Behavioural Therapy for Michael, Called Desjardins Insurance re: London Drugs Dental Coverage', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-02', '10:00', '13:00', 'Re: Dental Insurance', NULL, NULL, 'life_skills_task', NULL, 0, 'Michael Dental Insurance #1 Desjardins Dental Insurance', 'Michael Dental Insurance #2 Desjardins Dental Insurance', NULL, 'https://www.agea-gbim.dsf-dfs.com/AGEA-GBIM/Dcmnt/ConsulterDocument_ViewDocument.aspx?mode=NIF&cltr=en-CA&id=646b0ad1-6851-46d1-862b-44122c060f8e', NULL),
('2026-04-03', '10:00', '13:00', 'Sexual Behaviour Towards Female & Children Lessons (AreWeDatingTheSameGuy + Creep Catchers)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-07', '10:00', '13:00', 'Schedule Dental Appointment, Dunbar Community Centre Registration, Follow up with Rose from Back In Motion about the Vocational Assessment, Finalize Michael''s Schedule with Louise the Behaviour Therapist. Worked on personal hygiene', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-08', '10:00', '13:00', 'Daniel bought Michael a new Beard Shaver. Worked on personal hygiene', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-09', '10:00', '13:00', 'Caleb Cut Michael''s Fingernails and Taught Michael how to cut, shape, and file his own nails. Went to different stores to view prices for a new hair trimmer. Taught Michael how to clean his new razor. Took Michael to London Drugs to buy his personal hygiene items. After the meeting I had Michael go to London Drugs downtown to get a new discount card (every 3 months he needs a new one)', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-14', '10:00', '13:00', 'Michael''s First Behavioural Therapy Session', NULL, NULL, 'life_skills_task', NULL, 0, 'Sexual Behaviour Therapy', NULL, NULL, NULL, NULL),
('2026-04-16', '10:00', '13:00', 'Emailed WorkBC and requested a new case manager. Emailed Leanne from Jobs West. Drove Michael to London Drugs to get a reimbursement on his last purchase for hygienic items', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-21', '10:00', '13:00', 'Drove to the Ministry of Social Development: Collected Paystubs for the Ministry''s request to access Michael''s financial records + Memory Exercises: Puzzle Building', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-22', '10:00', '13:00', NULL, NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-28', '10:00', '13:00', 'Dentist Appointment (No Cavities). Gum issue — Michael was put on mouthwash for 1 week', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-29', '10:00', '13:00', 'Louise Sex Education Lesson — Consent', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-04-30', '10:00', '13:00', 'Michael Conflict with Erma From London Drugs', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-05-06', '10:00', '13:00', 'Sexual Behaviour Lessons W/ Caleb', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-05-07', '10:00', '13:00', 'Puzzle Strategies', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-05-12', '10:00', '13:00', 'Boxing Scheduled / WorkBC Inquiry / Measuring Sugar Exercises To Reduce Blood Pressure', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-05-13', '10:00', '13:00', 'Boxing preparation, Community Behavioural Assessment For Louise, Completing Puzzle Strategies', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL),
('2026-05-14', '10:00', '13:00', 'Resignation Letter to London Drugs / Apply for job in person at Bubble Waffle', NULL, NULL, 'life_skills_task', NULL, 0, NULL, NULL, NULL, NULL, NULL);


-- ─── For dates with no existing appointment, create a complimentary one ──
DO $$
DECLARE
  v_client_id  uuid;
  v_caleb_user uuid := '9b7b4106-1914-4062-818d-3074a0d2f7ff';
  v_tz         text := 'America/Vancouver';
  r record;
  v_start time;
  v_end   time;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE full_name = 'Michael Yang' LIMIT 1;

  FOR r IN
    SELECT m.* FROM _michael_lesson_rows m
    WHERE NOT EXISTS (
      SELECT 1 FROM public.appointments a
       WHERE a.client_id = v_client_id
         AND (a.starts_at AT TIME ZONE v_tz)::date = m.session_date
    )
  LOOP
    v_start := COALESCE(r.start_time, TIME '10:00:00');
    v_end   := COALESCE(r.end_time, v_start + INTERVAL '1 hour');

    INSERT INTO public.appointments
      (client_id, assistant_id, kind, status, starts_at, ends_at, duration_minutes,
       title, is_complimentary, created_by, updated_at)
    VALUES
      (v_client_id, v_caleb_user, 'admin_override', 'completed',
       (r.session_date::text || ' ' || v_start::text)::timestamp AT TIME ZONE v_tz,
       (r.session_date::text || ' ' || v_end::text)::timestamp AT TIME ZONE v_tz,
       GREATEST(15, EXTRACT(EPOCH FROM (v_end - v_start))::int / 60),
       COALESCE(LEFT(r.focus_area, 100), 'Lesson tracker entry (no billable session)'),
       true, v_caleb_user, NOW());
  END LOOP;
END $$;


-- ─── Insert lesson_logs — one per matched appointment ──────────────────
INSERT INTO public.session_lesson_logs
  (appointment_id, client_id, assistant_id, assistant_display_name,
   focus_area, key_concepts, status_label, type_label,
   feedback, rating, created_by)
SELECT
  a.id,
  a.client_id,
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'::uuid,
  'Caleb Brandt',
  m.focus_area,
  m.key_concepts,
  m.status_label,
  m.type_label,
  m.feedback,
  NULLIF(m.rating, 0),
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'::uuid
FROM _michael_lesson_rows m
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Michael Yang' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = m.session_date
-- One log per appointment — pick earliest if multiple rows match (rare edge case)
WHERE NOT EXISTS (SELECT 1 FROM public.session_lesson_logs l WHERE l.appointment_id = a.id);


-- ─── Insert file/url records (file_1, file_2, file_3, url_1, url_2) ─────
-- For each non-null file/url field, attach a row to the lesson_log.
INSERT INTO public.session_lesson_files
  (lesson_log_id, kind, display_name, storage_path, external_url,
   uploaded_by, uploaded_by_role, uploaded_by_display_name)
SELECT
  l.id,
  CASE WHEN x.kind = 'file' THEN 'file' ELSE 'url' END,
  x.value,
  CASE WHEN x.kind = 'file' THEN 'legacy/google-drive/' || x.value ELSE NULL END,
  CASE WHEN x.kind = 'url'  THEN x.value ELSE NULL END,
  '9b7b4106-1914-4062-818d-3074a0d2f7ff'::uuid,
  'assistant',
  'Caleb Brandt'
FROM _michael_lesson_rows m
JOIN public.appointments a
  ON a.client_id = (SELECT id FROM public.clients WHERE full_name = 'Michael Yang' LIMIT 1)
 AND (a.starts_at AT TIME ZONE 'America/Vancouver')::date = m.session_date
JOIN public.session_lesson_logs l ON l.appointment_id = a.id
JOIN LATERAL (
  VALUES
    ('file', m.file_1_name),
    ('file', m.file_2_name),
    ('file', m.file_3_name),
    ('url',  m.url_1),
    ('url',  m.url_2)
) x(kind, value) ON x.value IS NOT NULL;


-- ─── Verification ───────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM _michael_lesson_rows) AS source_rows,
  (SELECT COUNT(*) FROM public.session_lesson_logs l
    JOIN public.clients c ON c.id = l.client_id
    WHERE c.full_name = 'Michael Yang') AS lesson_logs_inserted,
  (SELECT COUNT(*) FROM public.session_lesson_files f
    JOIN public.session_lesson_logs l ON l.id = f.lesson_log_id
    JOIN public.clients c ON c.id = l.client_id
    WHERE c.full_name = 'Michael Yang') AS lesson_files_inserted,
  (SELECT COUNT(*) FROM public.appointments a
    JOIN public.clients c ON c.id = a.client_id
    WHERE c.full_name = 'Michael Yang') AS total_michael_appointments;

COMMIT;
