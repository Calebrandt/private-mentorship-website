  (function(){
    var mentorship=[
      {title:'Mind Over Matter:\nGrouse Mountain Hike',id:'F4nP_hi3SJ0'},
      {title:'Entrepreneurial Day:\nKids Business',id:'m-AhVBqke3Q'},
      {title:'Mentor & Mentee\nBirthday Milestones',id:'0KpO0BEIVkI'},
      {title:'Developing Stage:\nConfidence & Independence',id:'JCVzflJPfzI'},
      {title:'Mentorship For Adults:\nDeveloping New Habits',id:'NbLlkNrEVfw'},
      {title:'Mentor & Mentee\nPolice Museum',id:'2nliK8iLRtI'},
      {title:'Mentor & Mentee\nLansdowne Fair',id:'IZFNi2bPN5o'},
      {title:'Mentor & Mentee\nVancouver Art Gallery',id:'xlIZDl_8Ztk'},
      {title:'Mentor & Mentee\nBurnaby Mountain',id:'w0SJS1zy7h4'},
    ];
    var student=[
      {title:'Zoom Lesson:\nBusiness Vocabulary',id:'l0g8dvZREaU'},
      {title:'VOOV Lesson:\nIELTS Preparation',id:'vSv69Y1ImVk'},
      {title:'Zoom Lesson:\nBusiness Vocabulary',id:'WNe7NPnA9L0'},
      {title:'A True IELTS Love Story:\nLearning For Love!',id:'UBJkuHbA4sY'},
      {title:'English Lesson:\nTest Preparation',id:'I4Yl0ViKc0Q'},
      {title:'English Lesson:\nSentence Structure',id:'G2OwHexphto'},
      {title:'English Lesson:\nVocabulary Exercise',id:'Oh9DjPsBzxI'},
      {title:'Mother & Son',id:'08ADsXruLGU'},
      {title:'Figurative Language Lesson',id:'4PjbdwWWC2w'},
      {title:'English Lesson:\nGrocery Store Vocabulary',id:'NbLlkNrEVfw'},
      {title:'Business English:\nProfessional Email Writing',id:'YwwZ129sFFw'},
      {title:'English Lesson:\nLearning Tenses',id:'wgB8HtK87Tk'},
      {title:'English Lesson:\nLearning Tenses',id:'veIet217DMc'},
      {title:'English Lesson:\nBuddy Up, Level Up',id:'rJ_tsxpBfJQ'},
      {title:'Parent & Child:\nNew To Canada',id:'tVQ-4RDmFrA'},
      {title:'English Presentation:\n\u201cMedicine River\u201d',id:'i9sQmA0O4do'},
      {title:'English Presentation:\n\u201cThere There\u201d',id:'Tju-z5zKiEU'},
      {title:'Decode, Design, Deliver:\n\u201cThe Spy\u201d Analysis',id:'LNJuwfjQNwM'},
    ];
    var spotTrack = document.getElementById('spot-track');
    var spotDial = document.getElementById('spot-dial');
    var spotPlay = document.getElementById('spot-play');
    var playIcon = document.querySelector('.spotlight-play-icon');
    var pauseIcon = document.querySelector('.spotlight-pause-icon');
    var spotSlides = Array.prototype.slice.call(document.querySelectorAll('.spot-slide'));
    var currentIndex = 0;
    var autoTimer = null;
    var autoDelay = 4200;
    var isPlaying = false;
    var startX = 0;
    var deltaX = 0;
    var isDragging = false;
    var userPaused = false;
    var hasShownHint = false;
    var inView = false;

    var sessionSlide = document.getElementById('spot-slide-session');
    var sessionPreview = document.getElementById('spot-session-preview');
    var sessionModalPreview = document.getElementById('spot-session-modal-preview');
    var sessionModal = document.getElementById('spot-session-modal');
    var sessionModalClose = document.getElementById('spot-session-close');
    var sessionExpandBtn = document.getElementById('spot-expand-session');
    var sessionTabs = Array.prototype.slice.call(document.querySelectorAll('[data-session-tab]'));
    var activeSessionTab = 'student';
    var sessionExpanded = false;

    function getSessionItems() {
      return activeSessionTab === 'student' ? student : mentorship;
    }

    function getSessionLabel() {
      return activeSessionTab === 'student' ? 'STUDENT SPOTLIGHT' : 'MENTORSHIP SPOTLIGHT';
    }

    function updateSessionTabs() {
      for (var i = 0; i < sessionTabs.length; i++) {
        sessionTabs[i].classList.toggle('active', sessionTabs[i].getAttribute('data-session-tab') === activeSessionTab);
      }
    }

    function renderSessionGrid() {
      if (!sessionPreview && !sessionModalPreview) return;

      var items = getSessionItems();
      var visibleItems = sessionExpanded ? items : items.slice(0, 3);
      var label = getSessionLabel();

      var html = visibleItems.map(function(item, index) {
        var thumb = 'https://i.ytimg.com/vi/' + item.id + '/hqdefault.jpg';
        return [
          '<a class="spot-session-card" href="https://youtu.be/' + item.id + '" target="_blank" rel="noopener noreferrer">',
            '<img src="' + thumb + '" alt="' + label.toLowerCase() + ' video ' + (index + 1) + '" loading="lazy" />',
            '<span class="spot-session-play"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6,4 20,12 6,20"/></svg></span>',
            '<span class="spot-session-label">Real Session</span>',
          '</a>'
        ].join('');
      }).join('');

      if (sessionPreview) sessionPreview.innerHTML = html;
      if (sessionModalPreview) sessionModalPreview.innerHTML = html;

      if (sessionExpandBtn) {
        var btnLabel = sessionExpandBtn.querySelector('span');
        if (btnLabel) {
          btnLabel.textContent = 'See all ' + items.length + ' videos';
        } else {
          sessionExpandBtn.textContent = 'See all ' + items.length + ' videos →';
        }
      }

      if (sessionSlide) {
        sessionSlide.classList.remove('expanded');
      }
    }

    for (var t = 0; t < sessionTabs.length; t++) {
      sessionTabs[t].addEventListener('click', function() {
        activeSessionTab = this.getAttribute('data-session-tab');

        if (sessionModal && sessionModal.classList.contains('active')) {
          sessionExpanded = true;
        } else {
          sessionExpanded = false;
        }

        updateSessionTabs();
        renderSessionGrid();
      });
    }

    if (sessionExpandBtn) {
      sessionExpandBtn.addEventListener('click', function() {
        sessionExpanded = true;
        renderSessionGrid();

        if (sessionModal) {
          sessionModal.classList.add('active');
          document.body.style.overflow = 'hidden';
        }
      });
    }

    if (sessionModalClose) {
      sessionModalClose.addEventListener('click', function() {
        if (sessionModal) {
          sessionModal.classList.remove('active');
        }
        document.body.style.overflow = '';
        sessionExpanded = false;
        renderSessionGrid();
      });
    }

    if (sessionModal) {
      sessionModal.addEventListener('click', function(e) {
        if (e.target === sessionModal) {
          sessionModal.classList.remove('active');
          document.body.style.overflow = '';
          sessionExpanded = false;
          renderSessionGrid();
        }
      });
    }

    function buildDial() {
      if (!spotDial) return;
      spotDial.innerHTML = '';
      for (var i = 0; i < spotSlides.length; i++) {
        var dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'spot-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
        dot.style.border = 'none';
        dot.style.padding = '0';
        dot.style.cursor = 'pointer';
        dot.style.backgroundClip = 'padding-box';
        (function(index){
          dot.addEventListener('click', function(){
            goToSlide(index);
            stopAuto();
            userPaused = true;
          });
        })(i);
        spotDial.appendChild(dot);
      }
    }

    function updateDial() {
      var dots = spotDial ? spotDial.querySelectorAll('.spot-dot') : [];
      for (var i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('active', i === currentIndex);
      }
    }

    function getSlideStep() {
      if (!spotSlides.length) return 0;
      var style = window.getComputedStyle(spotTrack);
      var gap = parseFloat(style.columnGap || style.gap || 0);
      return spotSlides[0].offsetWidth + gap;
    }

function goToSlide(index) {
  if (!spotSlides.length) return;
  if (index < 0) index = 0;
  if (index > spotSlides.length - 1) index = spotSlides.length - 1;
  currentIndex = index;

  for (var i = 0; i < spotSlides.length; i++) {
    spotSlides[i].classList.toggle('active', i === currentIndex);
  }

  var step = getSlideStep();
  spotTrack.style.transform = 'translateX(' + (-step * currentIndex) + 'px)';
  updateDial();
}

    function nextSlide() {
      if (!spotSlides.length) return;
      currentIndex = (currentIndex + 1) % spotSlides.length;
      goToSlide(currentIndex);
    }

    function startAuto() {
      stopAuto();
      isPlaying = true;
      if (playIcon) playIcon.style.display = 'none';
      if (pauseIcon) pauseIcon.style.display = 'block';
      autoTimer = window.setInterval(function(){
        nextSlide();
      }, autoDelay);
    }

    function stopAuto() {
      isPlaying = false;
      if (playIcon) playIcon.style.display = 'block';
      if (pauseIcon) pauseIcon.style.display = 'none';
      if (autoTimer) {
        window.clearInterval(autoTimer);
        autoTimer = null;
      }
    }

    if (spotPlay) {
      spotPlay.addEventListener('click', function(){
        if (isPlaying) {
          stopAuto();
          userPaused = true;
        } else {
          startAuto();
          userPaused = false;
        }
      });
    }

    if (spotTrack) {
      spotTrack.addEventListener('pointerdown', function(e){
        isDragging = true;
        startX = e.clientX;
        deltaX = 0;
        stopAuto();
        userPaused = true;
        spotTrack.style.transition = 'none';
      });

      window.addEventListener('pointermove', function(e){
        if (!isDragging) return;
        deltaX = e.clientX - startX;
        var step = getSlideStep();
        spotTrack.style.transform = 'translateX(' + ((-step * currentIndex) + deltaX) + 'px)';
      });

      window.addEventListener('pointerup', function(){
        if (!isDragging) return;
        isDragging = false;
        spotTrack.style.transition = 'transform .6s cubic-bezier(.22,.61,.36,1)';
        if (deltaX < -80 && currentIndex < spotSlides.length - 1) {
          currentIndex += 1;
        } else if (deltaX > 80 && currentIndex > 0) {
          currentIndex -= 1;
        }
        goToSlide(currentIndex);
      });

      spotTrack.addEventListener('dragstart', function(e){
        e.preventDefault();
      });
    }

    window.addEventListener('resize', function(){
      goToSlide(currentIndex);
    });

    function peekHint() {
      if (!spotTrack || !spotSlides.length) return;
      var step = getSlideStep();
      var baseX = -step * currentIndex;
      spotTrack.style.transition = 'transform .85s cubic-bezier(.22,.61,.36,1)';
      spotTrack.style.transform = 'translateX(' + (baseX - 48) + 'px)';
      window.setTimeout(function(){
        spotTrack.style.transition = 'transform .85s cubic-bezier(.22,.61,.36,1)';
        spotTrack.style.transform = 'translateX(' + baseX + 'px)';
      }, 620);
    }

    var spotlightSection = document.getElementById('video-grid');
    if (spotlightSection && 'IntersectionObserver' in window) {
      var spotObserver = new IntersectionObserver(function(entries){
        entries.forEach(function(entry){
          if (entry.isIntersecting) {
            if (inView) return;
            inView = true;
            if (!hasShownHint) {
              hasShownHint = true;
              window.setTimeout(peekHint, 350);
              window.setTimeout(function(){
                if (inView && !userPaused) startAuto();
              }, 1700);
            } else if (!userPaused) {
              startAuto();
            }
          } else {
            if (!inView) return;
            inView = false;
            if (isPlaying) stopAuto();
          }
        });
      }, { threshold: 0.35 });
      spotObserver.observe(spotlightSection);
    }

buildDial();
updateSessionTabs();
renderSessionGrid();
goToSlide(0);
    })();
  

  (function() {
    const AGI_DATA = [
      { eyebrow: "Role 01 — The Foundation", title: "Education", img: "assets/images/ages_01.jpg", body: "Every relationship starts here. During structured weekly sessions, your assistant becomes a trusted teacher — English, math, coursework, or any subject your family member needs. But this isn’t just tutoring. Week after week, in the same private setting, the client builds something no classroom can replicate: genuine trust with someone who shows up consistently, knows them personally, and cares about their progress. That trust is the ingredient that makes everything else possible.", roles: [1, 0, 0], tags: ["1-on-1 Private Lessons", "Homework & Test Support", "Academic Coaching", "Career Coursework", "Job Skills Training", "English & Language"] },
      { eyebrow: "Role 02 — The Bridge", title: "Life Skills", img: "assets/images/ages_02.jpg", body: "The trust earned in education becomes power in the real world. Because the client already respects their assistant as a teacher, that same person now becomes a mentor — a big brother or big sister. In life skills sessions, they’re not in a classroom. They’re at a community event, on a hike, in a real conversation about relationships and confidence. The client listens differently when it’s someone they already trust. That’s the difference between instruction and transformation.", roles: [1, 1, 0], tags: ["Social Communication", "Community Outings", "Confidence Building", "Friendship & Relationships", "Independence Training", "Identity & Purpose"] },
      { eyebrow: "Role 03 — The Anchor", title: "Personal Support", img: "assets/images/ages_03.jpg", body: "By now, the client has watched their assistant handle the most important parts of life — and they’ve been taking notes. The assistant books doctors and dentists, attends job interviews alongside the client, fights for their position if an employer terminates them, sits in job skills training taking notes, navigates WorkBC and government funding, handles government paperwork, coordinates school and parent-teacher conferences. The family doesn’t just receive help — they watch someone model what it looks like to handle life with competence and dignity.", roles: [1, 1, 1], tags: ["Medical & Govt Appointments", "Job Interview Support", "WorkBC & Funding", "School Coordination", "Business & Email Support", "Elder Companionship"] },
      { eyebrow: "Ages 6–13 — Children & Pre-Teens", title: "Academic Foundation & a Trusted Adult", img: "assets/images/ages_01.jpg", body: "Parents of young children have one priority: consistent, positive academic support. The assistant enters as an educator — private lessons, homework, school coordination. Week after week, something natural happens: the child begins to look forward to their sessions. They trust this adult. And that trust opens the door to social confidence and communication skills no classroom can teach. The assistant also handles pick-up, drop-off, lunch prep, and parent-teacher conferences — so parents never have to leave work early or miss something important again.", roles: [1, 1, 0], tags: ["Private Lessons", "Homework Support", "Pick-Up & Drop-Off", "Communication Skills", "Community Outings", "School Coordination"] },
      { eyebrow: "Ages 14–19 — Teenagers & Young Adults", title: "Identity, Academics & the Big Brother Effect", img: "assets/images/ages_02.jpg", body: "Teenagers are at a crossroads — academics matter, but so does who they’re becoming. This is where the compounding effect of Private Mentorship becomes most visible. The trust established through education sessions makes teens open to real conversations about identity, relationships, friendships, and purpose. The assistant becomes a Big Brother or Big Sister — someone who shows them how to carry themselves in the world, not just in the classroom. Career prep, resume writing, college applications, real outings, real conversations. Someone who actually gets them.", roles: [1, 1, 0], tags: ["Academic Coaching", "Career Prep & Resume", "Social Skills Training", "College Preparation", "Real-World Outings", "Identity & Confidence"] },
      { eyebrow: "Ages 20–65+ — Adults & Seniors", title: "All Three Roles. Fully Active.", img: "assets/images/ages_03.jpg", body: "Adults and seniors carry the most complexity — job transitions, language barriers, government paperwork, medical appointments, social isolation. The assistant steps into all of it, side by side. New immigrants find someone who speaks for them and helps them integrate. Seniors find genuine companionship, routine, and an advocate. Adults find someone who attends job interviews with them, navigates WorkBC, secures government funding, and fights for their opportunities. This isn’t support. This is a partner in your corner.", roles: [1, 1, 1], tags: ["Job Skills Training", "WorkBC & Funding", "Medical Appointments", "Elder Companionship", "Immigration Support", "Business Coordination"] },
      { eyebrow: "Any Age — Intensive 1-on-1 Support", title: "Special Needs & Disability", img: "assets/images/ages_01.jpg", body: "For individuals with special needs or on disability — whether a child, teen, or adult — the Private Family Assistant provides intensive, consistent, deeply personal support across all three roles simultaneously. The assistant becomes more than a support worker. They become an anchor. Someone who genuinely knows your family member, advocates for them in every room, fights for disability funding, attends CLBC meetings, and helps them access a life not defined or limited by their diagnosis. The family finally has someone who truly shows up.", roles: [1, 1, 1], tags: ["Adaptive Education", "Social Integration", "CLBC & WorkBC Navigation", "Govt Advocacy", "Disability Funding", "1-on-1 Support"] }
    ];
    window.switchAgi = function(idx) {
      const data = AGI_DATA[idx];
      document.querySelectorAll('.agi-nav-item').forEach((btn, i) => btn.classList.toggle('active', i === idx));
      const indicator = document.getElementById('agiIndicator');
      const labelOffset = idx > 2 ? 52 : 0; indicator.style.transform = `translateY(${idx * 44 + labelOffset}px)`;
      document.querySelectorAll('.agi-bg-photo').forEach((img, i) => img.classList.toggle('active', i === idx));
      const pod = document.getElementById('agiPod'); pod.classList.remove('active');
      setTimeout(() => {
        document.getElementById('agiEyebrow').textContent = data.eyebrow;
        document.getElementById('agiTitle').textContent = data.title;
        document.getElementById('agiBody').textContent = data.body;
        document.getElementById('agiTags').innerHTML = data.tags.map(t => `<span class="agi-auth-tag">${t}</span>`).join('');
        const previewImg = document.getElementById('agiPreviewImg');
        const previewTitle = document.getElementById('agiPreviewTitle');
        if (previewImg) previewImg.src = data.img;
        if (previewTitle) previewTitle.textContent = data.title;
        pod.classList.add('active');
      }, 250);
      data.roles.forEach((active, i) => { document.getElementById('node' + i).classList.toggle('active', !!active); if (i < 2) document.getElementById('line' + i).classList.toggle('active', active && data.roles[i+1]); });
      if (window._agiSetCursorColor) window._agiSetCursorColor(idx);
        };
    const agiBg = document.getElementById('agiBg');
    if (agiBg) { AGI_DATA.forEach((d, i) => { const img = document.createElement('img'); img.src = d.img; img.className = 'agi-bg-photo' + (i === 0 ? ' active' : ''); agiBg.appendChild(img); }); switchAgi(0); }
  })();

  
  (function() {
    "use strict";
    var DATA = [
      { src:"assets/images/sp_02.jpg", cat:"Community",    title:"A Day at the Fair",               desc:"Winning prizes, riding rides, navigating crowds — it takes real confidence to thrive at a busy carnival. Days like this build social skills and show clients they can handle anything the world throws at them.",               date:"Summer 2024",   client:"Kay",        category:"Community",    duration:"8 Months",   milestone:"First Crowded Event Alone" },
      { src:"assets/images/sp_03.jpg", cat:"Community",    title:"Big Win, Bigger Smile",           desc:"That look after winning something you worked for. The fair was loud, crowded, and unpredictable — the best kind of classroom. Real-world confidence comes from real-world wins.",           date:"Summer 2024",   client:"Kay",        category:"Community",    duration:"8 Months",   milestone:"Navigated Full Fair Independently" },
      { src:"assets/images/sp_08.jpg", cat:"Community",    title:"Hitting the Trail Together",      desc:"Some of the best conversations happen when you are moving. A group hike builds physical stamina, trust, and teamwork all at once. Nobody gets left behind.",      date:"Summer 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Completed First 5km Hike" },
      { src:"assets/images/sp_11.jpg", cat:"Community",    title:"Leading the Way",                 desc:"On the trail, there are no shortcuts and no excuses. Pointing out the path ahead, encouraging each other, and pushing through discomfort together — this is what growth looks like in nature.",                 date:"Summer 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Led Group on Trail for First Time" },
      { src:"assets/images/sp_12.jpg", cat:"Community",    title:"The Climb is the Point",          desc:"It is not about the destination. Every step up the trail is a lesson in persistence, pacing, and believing in yourself. Side by side the whole way.",          date:"Summer 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Hiked Without Breaks" },
      { src:"assets/images/sp_13.jpg", cat:"Community",    title:"Off the Beaten Path",             desc:"Climbing over roots, ducking under branches, exploring what is not on the map. Building a sense of adventure and physical courage in the real world.",             date:"Summer 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Explored Unstructured Trail Alone" },
      { src:"assets/images/sp_16.jpg", cat:"Life Skills",  title:"Open for Business",               desc:"They wrote the menu, set the prices, and set everything up themselves. Running a lemonade stand is a full business lesson, math, customer service, money handling, and entrepreneurial pride.",               date:"Summer 2023",   client:"Nathan",     category:"Life Skills",  duration:"22 Months",  milestone:"First Earned Dollar" },
      { src:"assets/images/sp_17.jpg", cat:"Life Skills",  title:"The Real Entrepreneurs",          desc:"Two kids at a lemonade stand, making their own money for the first time. The skills practiced here, pricing, making change, talking to strangers, are the same ones that shape a future.",          date:"Summer 2023",   client:"Nathan",     category:"Life Skills",  duration:"22 Months",  milestone:"Sold Out in One Afternoon" },
      { src:"assets/images/sp_18.jpg", cat:"Life Skills",  title:"Physical Goals, Real Progress",   desc:"Monkey bars in the sun. Setting a physical goal, showing up, and grinding until you get there. Physical confidence translates directly into confidence everywhere else.",   date:"Fall 2024",     client:"Nathan",     category:"Life Skills",  duration:"22 Months",  milestone:"10 Bars Without Stopping" },
      { src:"assets/images/sp_19.jpg", cat:"Mentorship",   title:"A Bond Built on Respect",         desc:"The handshake that means something. Two years of showing up, being consistent, and genuinely caring about someone's growth creates a relationship that goes far beyond assistant and client.",         date:"Fall 2024",     client:"Nathan",     category:"Mentorship",   duration:"22 Months",  milestone:"Trusted Fully and Completely" },
      { src:"assets/images/sp_20.jpg", cat:"Life Skills",  title:"Pushing Past the Limit",          desc:"Push-ups in the park. No gym required. Teaching discipline, physical health, and the mindset that you can always do one more. Setting the bar high and clearing it.",          date:"Fall 2024",     client:"Nathan",     category:"Life Skills",  duration:"22 Months",  milestone:"30 Push-Ups Unbroken" },
      { src:"assets/images/sp_21.jpg", cat:"Life Skills",  title:"Form, Focus, Follow Through",     desc:"Every rep done right matters more than ten done wrong. Teaching proper form and personal accountability so that good habits carry over long after sessions end.",     date:"Fall 2024",     client:"Nathan",     category:"Life Skills",  duration:"22 Months",  milestone:"Built 3x Weekly Fitness Habit" },
      { src:"assets/images/sp_23.jpg", cat:"Life Skills",  title:"First Day at the Gym",            desc:"Walking into a gym for the first time can feel intimidating. Having someone beside you who knows what they are doing makes all the difference. This was the first of many sessions.",            date:"March 2025",    client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Gym Membership Activated" },
      { src:"assets/images/sp_26.jpg", cat:"Life Skills",  title:"Building Strength, Week by Week", desc:"Consistency is the whole game. Showing up to the gym three times a week and tracking real progress builds both a stronger body and a stronger sense of self-discipline.",date:"April 2025",    client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Increased Weight Every Month" },
      { src:"assets/images/sp_27.jpg", cat:"Life Skills",  title:"The Work Speaks for Itself",      desc:"Lunges, squats, and a full fitness routine. What started as a basic introduction to the gym turned into a genuine commitment to personal health and physical independence.",      date:"April 2025",    client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Full Workout Done Independently" },
      { src:"assets/images/sp_28.jpg", cat:"Life Skills",  title:"Arm Day, Every Week",             desc:"Progress is visible. What you put in is exactly what you get out. Watching a client go from not knowing how to hold a bar to hitting personal records is one of the best parts of this work.",             date:"May 2025",      client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"First Personal Best" },
      { src:"assets/images/sp_30.jpg", cat:"Life Skills",  title:"Bench Press Milestone",           desc:"Lying back, loading the bar, and lifting more than you thought possible. Every plate added is proof that the work is paying off. Strength training changes how you carry yourself in the world.",           date:"May 2025",      client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Lifted Body Weight on Bench" },
      { src:"assets/images/sp_32.jpg", cat:"Mentorship",   title:"Leading by Example",              desc:"Your mentor is doing the work right beside you. Not standing at the sidelines and coaching from a distance, but grinding through the same session, rep for rep.",              date:"June 2025",     client:"Hao",        category:"Mentorship",   duration:"16 Months",  milestone:"Mentor Trained Alongside Client" },
      { src:"assets/images/sp_24.jpg", cat:"Community",    title:"Breathing Room",                  desc:"Sometimes the most important thing is just being somewhere calm and open. A quiet park, fresh air, and space to reflect — these moments are part of the growth too.",                  date:"September 2024",client:"Nathan",     category:"Community",    duration:"22 Months",  milestone:"Initiated Outdoor Time Independently" },
      { src:"assets/images/sp_25.jpg", cat:"Community",    title:"Belonging in the World",          desc:"Sitting comfortably in a public space, relaxed, and at ease. This is what years of community outings builds — the feeling that you belong wherever you go.",          date:"September 2024",client:"Nathan",     category:"Community",    duration:"22 Months",  milestone:"Went to Park Alone for First Time" },
      { src:"assets/images/sp_01.jpg", cat:"Community",    title:"Exploring Vancouver Together",    desc:"The Vancouver Police Museum is one stop on a long list of places explored together. Cultural outings build curiosity, vocabulary, and a genuine connection to the city they live in.",    date:"Fall 2024",     client:"Kay",        category:"Community",    duration:"8 Months",   milestone:"Visited 10 New Places" },
      { src:"assets/images/sp_04.jpg", cat:"Community",    title:"Art Gallery Afternoon",           desc:"Standing in front of large-scale architectural art and actually thinking about it. Outings like this expand perspective and build the vocabulary to talk about the world around you.",           date:"Winter 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"First Art Gallery Visit" },
      { src:"assets/images/sp_05.jpg", cat:"Community",    title:"Culture as a Classroom",          desc:"A textile sculpture exhibit at a Vancouver gallery. Every cultural outing is a lesson in observation, discussion, and being present in a space that feels unfamiliar.",          date:"Winter 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Asked First Question at a Gallery" },
      { src:"assets/images/sp_06.jpg", cat:"Community",    title:"Seeing the World Differently",    desc:"Standing in front of a large abstract painting and letting it speak. Building the habit of paying attention — to art, to people, to the world — is a life skill that never stops paying off.",    date:"Winter 2024",   client:"Jayde",      category:"Community",    duration:"14 Months",  milestone:"Expressed Opinion About Art" },
      { src:"assets/images/sp_07.jpg", cat:"Daily Support",title:"Sunday Brunch with a View",       desc:"A proper meal, a great view, and genuine conversation. Being present with a client during the everyday moments — not just the structured sessions — is what builds a real mentorship relationship.",       date:"Spring 2024",   client:"Hao",        category:"Daily Support",duration:"16 Months",  milestone:"First Independently Hosted Meal" },
      { src:"assets/images/sp_09.jpg", cat:"Life Skills",  title:"Labelling the Kitchen",           desc:"A simple but powerful exercise. Labelling everything in the kitchen builds vocabulary, independence, and confidence in daily routines. Real life skills start with knowing your environment.",           date:"Spring 2023",   client:"Kay",        category:"Life Skills",  duration:"8 Months",   milestone:"Named All Kitchen Items Independently" },
      { src:"assets/images/sp_10.jpg", cat:"Life Skills",  title:"Learning Through Labelling",      desc:"A glass teapot, labelled and understood. Breaking down the kitchen into simple, named parts gives clients the language and confidence to navigate daily life on their own terms.",      date:"Spring 2023",   client:"Kay",        category:"Life Skills",  duration:"8 Months",   milestone:"Used Kitchen Independently" },
      { src:"assets/images/sp_14.jpg", cat:"Education",    title:"Working Through It Together",     desc:"Side by side at the board, figuring it out in real time. The mentor does not just give answers — they work through problems together so the client builds the thinking skills, not just the answer.",     date:"Fall 2023",     client:"Kay",        category:"Education",    duration:"8 Months",   milestone:"Solved Problem Without Help" },
      { src:"assets/images/sp_15.jpg", cat:"Education",    title:"Late Night Study Session",        desc:"After dinner, textbooks open, working hard. Being there for a client means being there whenever they need support, including the long evenings before important tests and deadlines.",        date:"Winter 2023",   client:"Jayde",      category:"Education",    duration:"14 Months",  milestone:"Passed End of Term Exam" },
      { src:"assets/images/sp_35.jpg", cat:"Education",    title:"Focus Time at Home",              desc:"A child at the dining table, laptop open, pencil in hand. Building a real study routine at home is one of the most important habits a mentor can help establish.",              date:"Spring 2024",   client:"Emma",       category:"Education",    duration:"6 Months",   milestone:"30-Minute Daily Study Habit Built" },
      { src:"assets/images/sp_36.jpg", cat:"Education",    title:"Brothers Learning Side by Side",  desc:"Two siblings at the same table, both focused. When the whole family gets involved in a routine, the results multiply. A positive study environment changes everything.",  date:"Spring 2024",   client:"Emma",       category:"Education",    duration:"6 Months",   milestone:"Homework Done Before Screen Time" },
      { src:"assets/images/sp_33.jpg", cat:"Education",    title:"Connected Across the Distance",   desc:"Not all sessions are in person. Virtual check-ins make the mentorship consistent no matter where the client is in the world. The relationship does not pause because of geography.",   date:"January 2025",  client:"Hao",        category:"Education",    duration:"16 Months",  milestone:"First Virtual Session Completed" },
      { src:"assets/images/sp_34.jpg", cat:"Education",    title:"Online, On Time, On Point",       desc:"Evening virtual sessions have become part of the weekly rhythm. Showing up on screen with the same energy and consistency as in person. The client knows their mentor is always there.",       date:"February 2025", client:"Jayde",      category:"Education",    duration:"14 Months",  milestone:"Consistent Virtual Attendance" },
      { src:"assets/images/sp_37.jpg", cat:"Education",    title:"A Session Worth Smiling About",   desc:"That genuine smile at the start of a call. When a client actually looks forward to their sessions, that is when you know the relationship is working. Trust and joy are the foundation.",   date:"April 2024",    client:"Li",         category:"Education",    duration:"12 Months",  milestone:"Said She Looks Forward to Sessions" },
      { src:"assets/images/sp_39.jpg", cat:"Mentorship",   title:"Joy Across the Screen",           desc:"Pure joy captured in a single frame. This is what a real mentorship relationship looks like after months of consistent, caring, and genuine support. Results you can feel.",           date:"April 2024",    client:"Li",         category:"Mentorship",   duration:"12 Months",  milestone:"Client Expressed Deep Gratitude" },
      { src:"assets/images/sp_38.jpg", cat:"Community",    title:"Matching Energy",                 desc:"Shopping trip, matching shirts, and a mirror selfie that sums up the whole relationship. Real mentorship includes the fun moments, the errands, the laughs, and the ordinary days that build something extraordinary.",                 date:"Summer 2024",   client:"Nathan",     category:"Community",    duration:"22 Months",  milestone:"Client Initiated an Outing" },
      { src:"assets/images/sp_29.jpg", cat:"Life Skills",  title:"Reps and Responsibility",         desc:"Every gym session is a lesson in showing up and doing the work even when you do not feel like it. The discipline built here transfers directly into every other area of life.",         date:"June 2025",     client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Never Missed a Scheduled Session" },
      { src:"assets/images/sp_31.jpg", cat:"Life Skills",  title:"Cable Work, Core Focus",          desc:"Advanced gym programming for a client who started with zero experience. This is what eighteen months of consistent effort produces, confidence, technique, and a genuine love of training.",          date:"July 2025",     client:"Hao",        category:"Life Skills",  duration:"16 Months",  milestone:"Training Independently 3x Per Week" },
      { src:"assets/images/sp_40.jpg", cat:"Community",    title:"Open Sky, Open Mind",             desc:"Standing in a wide open field under a big sky. Some of the most important moments in a mentorship happen in quiet, open spaces where there is nothing to do but be present and talk.",             date:"August 2025",   client:"Nathan",     category:"Community",    duration:"22 Months",  milestone:"Started Journaling Outdoors" },
      { src:"assets/images/sp_22.jpg", cat:"Mentorship",   title:"Your Mentor Does the Work Too",   desc:"Leading by example means actually doing the work, not just directing others. When your mentor drops down and does the push-ups beside you, the message is clear: we are in this together.",   date:"Fall 2024",     client:"Nathan",     category:"Mentorship",   duration:"22 Months",  milestone:"Mentor and Client Same Fitness Level" },
      { src:"assets/images/sp_41.jpg", cat:"Community",    title:"Finding Their Place",             desc:"Outdoors, relaxed, and genuinely at ease. After months of outings and guided experiences, a client who once felt anxious in the world starts to carry themselves like they belong everywhere.",             date:"August 2025",   client:"Nathan",     category:"Community",    duration:"22 Months",  milestone:"Requested Solo Outdoor Time" },
      { src:"assets/images/sp_42.jpg", cat:"Community",    title:"History Makes You Think",         desc:"A stained glass window, a 100-year-old story, and a meaningful conversation about legacy. These are the moments that open a young person up to the world beyond their immediate experience.",         date:"Fall 2024",     client:"Kay",        category:"Community",    duration:"8 Months",   milestone:"Asked Mentor a Deep Question Unprompted" }
    ];

    var N         = DATA.length;
    var NAV_H     = 72;
    var PPP       = 700;

    var space     = document.getElementById("sp-space");
    var stickyEl  = document.getElementById("sp-sticky");
    var imgA      = document.getElementById("sp-img-a");
    var imgB      = document.getElementById("sp-img-b");
    var photoWrap = document.getElementById("sp-photo-wrap");
    var infoEl    = document.getElementById("sp-info");
    var catEl     = document.getElementById("sp-cat");
    var titleEl   = document.getElementById("sp-title");
    var descEl    = document.getElementById("sp-desc");
    var dateEl    = document.getElementById("sp-date");
    var clientEl  = document.getElementById("sp-client");
    var catgEl    = document.getElementById("sp-category");
    var durEl     = document.getElementById("sp-duration");
    var mileEl    = document.getElementById("sp-milestone");
    var stripList = document.getElementById("sp-strip-list");
    var counterEl = document.getElementById("sp-counter");
    var prevBtn   = document.getElementById("sp-prev");
    var nextBtn   = document.getElementById("sp-next");
    var soundBtn  = document.getElementById("sp-sound-btn");
    var skipBtn       = document.getElementById("sp-skip");
    var skipLabel     = document.getElementById("sp-skip-label");
    var skipIcon      = document.getElementById("sp-skip-icon");
    var lastIdx       = 0;
    var scrollingDown = true;

    var THUMB_H   = 82;
    var THUMB_GAP = 10;
    var ITEM_H    = THUMB_H + THUMB_GAP;
    var STRIP_VIS = 460;

    var thumbEls   = [];
    var currentRaw = 0;
    var targetRaw  = 0;
    var activeIdx  = 0;
    var activeLayer= "a";
    var soundOn    = true;
    var audioCtx   = null;

    function detectNavH() {
      var candidates = document.querySelectorAll("nav, header");
      for (var i = 0; i < candidates.length; i++) {
        var cs = window.getComputedStyle(candidates[i]);
        if (cs.position === "fixed" || cs.position === "sticky") {
          return candidates[i].offsetHeight || NAV_H;
        }
      }
      return NAV_H;
    }

    function playClick() {
      if (!soundOn) return;
      try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        var sr  = audioCtx.sampleRate;
        var len = Math.floor(sr * 0.038);
        var buf = audioCtx.createBuffer(1, len, sr);
        var d   = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6) * 0.32;
        }
        var src  = audioCtx.createBufferSource();
        src.buffer = buf;
        var filt = audioCtx.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.value = 2600;
        filt.Q.value = 0.9;
        src.connect(filt);
        filt.connect(audioCtx.destination);
        src.start();
      } catch(e) {}
    }

    function init() {
      NAV_H = detectNavH();
      stickyEl.style.top    = NAV_H + "px";
      stickyEl.style.height = "calc(100vh - " + NAV_H + "px)";

      STRIP_VIS = 420;
      space.style.height = ((N - 1) * PPP + window.innerHeight - NAV_H) + "px";

      DATA.forEach(function(d) {
        var wrap = document.createElement("div");
        wrap.style.cssText = "width:100%;height:" + THUMB_H + "px;border-radius:9px;overflow:hidden;margin-bottom:" + THUMB_GAP + "px;";
        var img = document.createElement("img");
        img.src = d.src;
        img.alt = d.title;
        img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
        wrap.appendChild(img);
        stripList.appendChild(wrap);
        thumbEls.push(wrap);
      });

      loadContent(0, true);
      updateStrip(0);

      window.addEventListener("scroll", onScroll, { passive: true });
      requestAnimationFrame(tick);

      prevBtn.addEventListener("click", function() { goTo(activeIdx - 1); });
      nextBtn.addEventListener("click", function() { goTo(activeIdx + 1); });

      window.spSkipGallery = function() {
        if (scrollingDown) {
          var spaceBottom = space.getBoundingClientRect().bottom + window.scrollY;
          window.scrollTo({ top: spaceBottom, behavior: "smooth" });
        } else {
          var spaceTop = space.getBoundingClientRect().top + window.scrollY - NAV_H - 40;
          window.scrollTo({ top: spaceTop, behavior: "smooth" });
        }
      };

      soundBtn.addEventListener("click", function() {
        soundOn = !soundOn;
        soundBtn.style.opacity = soundOn ? "1" : "0.3";
        if (soundOn && !audioCtx) {
          try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
        }
      });

      photoWrap.addEventListener("mouseenter", function() {
        imgA.style.filter = "grayscale(0%)";
        imgB.style.filter = "grayscale(0%)";
      });
      photoWrap.addEventListener("mouseleave", function() {
        imgA.style.filter = "grayscale(100%)";
        imgB.style.filter = "grayscale(100%)";
      });
    }

    function onScroll() {
      var spaceTop     = space.getBoundingClientRect().top + window.scrollY;
      var stickyStart  = spaceTop - NAV_H;
      var scrolled     = Math.max(0, window.scrollY - stickyStart);
      var scrollRange  = Math.max(1, (N - 1) * PPP);
      targetRaw        = Math.min(N - 1, (scrolled / scrollRange) * (N - 1));
    }

    function tick() {
      currentRaw += (targetRaw - currentRaw) * 0.09;
      var newIdx = Math.min(N - 1, Math.max(0, Math.round(currentRaw)));
      if (newIdx !== activeIdx) {
        activeIdx = newIdx;
        loadContent(activeIdx, false);
        playClick();
      }
      updateStrip(currentRaw);
      requestAnimationFrame(tick);
    }

    function loadContent(idx, instant) {
      var d = DATA[idx];
      counterEl.textContent = String(idx + 1).padStart(2, "0") + " / " + N;
      if (skipBtn) {
        scrollingDown = idx >= lastIdx;
        lastIdx = idx;
        var show = idx >= 3;
        skipBtn.style.opacity = show ? "1" : "0";
        skipBtn.style.pointerEvents = show ? "auto" : "none";
        if (show) {
          if (scrollingDown) {
            skipLabel.textContent = "Skip gallery";
            skipIcon.innerHTML = '<path d="M6 2v8M2 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
          } else {
            skipLabel.textContent = "Skip back up";
            skipIcon.innerHTML = '<path d="M6 10V2M2 6l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
          }
        }
      }
      var hovered = photoWrap.matches(":hover");
      var gs = hovered ? "grayscale(0%)" : "grayscale(100%)";
      if (activeLayer === "a") {
        imgB.src = d.src;
        imgB.style.filter  = gs;
        imgB.style.opacity = "1";
        imgA.style.opacity = "0";
        activeLayer = "b";
      } else {
        imgA.src = d.src;
        imgA.style.filter  = gs;
        imgA.style.opacity = "1";
        imgB.style.opacity = "0";
        activeLayer = "a";
      }
      if (instant) {
        setInfo(d);
      } else {
        infoEl.style.opacity   = "0";
        infoEl.style.transform = "translateY(7px)";
        setTimeout(function() {
          setInfo(d);
          infoEl.style.opacity   = "1";
          infoEl.style.transform = "translateY(0)";
        }, 200);
      }
    }

    function setInfo(d) {
      catEl.textContent    = d.cat;
      titleEl.textContent  = d.title;
      descEl.textContent   = d.desc;
      dateEl.textContent   = d.date;
      clientEl.textContent = d.client;
      catgEl.textContent   = d.category;
      durEl.textContent    = d.duration;
      mileEl.textContent   = d.milestone;
    }

    function updateStrip(raw) {
      var ty = STRIP_VIS / 2 - ITEM_H / 2 - raw * ITEM_H;
      stripList.style.transform = "translateY(" + ty.toFixed(2) + "px)";
      thumbEls.forEach(function(el, i) {
        var dist    = Math.abs(i - raw);
        var scale   = Math.max(0.46, 1 - dist * 0.15);
        var opacity = Math.max(0.11, 1 - dist * 0.28);
        var gs      = Math.min(100, dist * 72);
        el.style.transform  = "scale(" + scale.toFixed(3) + ")";
        el.style.opacity    = opacity.toFixed(3);
        el.style.filter     = "grayscale(" + Math.round(gs) + "%)";
        el.style.transition = "transform 0.14s, opacity 0.14s, filter 0.14s";
      });
    }

    function goTo(idx) {
      if (idx < 0) idx = 0;
      if (idx >= N) idx = N - 1;
      var spaceTop    = space.getBoundingClientRect().top + window.scrollY;
      var stickyStart = spaceTop - NAV_H;
      var scrollRange = (N - 1) * PPP;
      var scrollTarget = stickyStart + (idx / (N - 1)) * scrollRange;
      window.scrollTo({ top: scrollTarget, behavior: "smooth" });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();
  
  
  (function(){
    var data=[
      {q:'What is Private Mentorship?',a:'Private Mentorship is a personalized assistant and mentorship service designed to support education, family coordination, and daily life needs. Each family is assigned dedicated weekly time blocks with a trained assistant who works closely with them in structured sessions.'},
      {q:'How do contract terms work?',a:'Plans are purchased in fixed terms (1 month or 2 months) and include a set number of reserved hours. These hours are scheduled into recurring weekly time blocks to ensure consistent availability.'},
      {q:'What does \u201cReserved Weekly Time Blocks\u201d mean?',a:'Your hours are not booked ad-hoc. They are reserved in advance as standing weekly windows, ensuring predictable access and consistency.'},
      {q:'Where do sessions take place?',a:'Sessions can take place at the family\u2019s home, at the assistant\u2019s location, in public spaces (libraries, caf\u00e9s, activity centers), or online. Location depends on the session goal.'},
      {q:'Is transportation included?',a:'Transportation support may be available when the assigned assistant has access to a vehicle. This can include pickup and drop-off for sessions or activities.'},
      {q:'What is Homework Screen Recording?',a:'During learning sessions, the screen can be recorded so parents can review progress later. This allows parents to stay informed without needing to supervise in real time.'},
      {q:'Can we reschedule or cancel sessions?',a:'Each plan includes a limited number of reschedules per term. This ensures flexibility while protecting the integrity of reserved time blocks.'},
      {q:'Can we change our assistant?',a:'Yes. If a family feels the match is not ideal, a replacement can be requested. Continuity and fit are important to the success of the program.'},
      {q:'What kind of administrative support is included?',a:'Assistants can help with emails, family coordination, documentation, and scheduling. This support is handled within the boundaries of the contracted hours.'},
    ];
    var list=document.getElementById('faq-list');
    data.forEach(function(item,i){
      var num=String(i+1).padStart(2,'0');
      var row=document.createElement('div');
      row.className='faq-row';
      row.innerHTML='<button class="faq-btn" aria-expanded="false"><span class="faq-badge">'+num+'</span><span class="faq-question">'+item.q+'</span><span class="faq-toggle" aria-hidden="true"><svg viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" stroke-width="2" stroke-linecap="round"><line x1="9" y1="2" x2="9" y2="16"/><line x1="2" y1="9" x2="16" y2="9"/></svg></span></button><div class="faq-panel" role="region"><div class="faq-panel-inner"><p class="faq-answer">'+item.a+'</p></div></div>';
      var btn=row.querySelector('.faq-btn');
      btn.addEventListener('click',function(){
        var isOpen=row.classList.contains('open');
        document.querySelectorAll('.faq-row.open').forEach(function(other){
          if(other!==row){other.classList.remove('open');other.querySelector('.faq-btn').setAttribute('aria-expanded','false');}
        });
        row.classList.toggle('open',!isOpen);
        btn.setAttribute('aria-expanded',String(!isOpen));
      });
      list.appendChild(row);
    });
  })();
  
  
    // ── Age Groups White Card ──
    var nodeStates = [
      [1, 0, 0], // Education
      [1, 1, 0], // Life Skills
      [1, 1, 1], // Personal Support
      [1, 1, 0], // Children 6-13
      [1, 1, 0], // Teens 14-19
      [1, 1, 1], // Adults 20-65+
      [1, 1, 1], // Special Needs
    ];

    function selectAGI(index) {
      // Update sidebar items (circle + label)
      document.querySelectorAll('.agi-item').forEach(function(btn, i) {
        var circle = btn.querySelector('.agi-circle');
        if (i === index) {
          btn.classList.add('agi-item-on');
          if (circle) circle.innerHTML = '&#8722;';
        } else {
          btn.classList.remove('agi-item-on');
          if (circle) circle.innerHTML = '+';
        }
      });

      // Update compound nodes
      var states = nodeStates[index] || [0,0,0];
      for (var c = 0; c < 3; c++) {
        var dot = document.getElementById('agiCdot' + c);
        var lbl = document.getElementById('agiCname' + c);
        if (dot) dot.classList.toggle('agi-cnode-dot-on', !!states[c]);
        if (lbl) lbl.classList.toggle('agi-cnode-name-on', !!states[c]);
        if (c < 2) {
          var glow = document.getElementById('agiGlow' + c);
          if (glow) glow.style.animationPlayState = (states[c] && states[c+1]) ? 'running' : 'paused';
        }
      }

      // Swap panels + scroll right content to top
      var content = document.querySelector('.agi-content');
      document.querySelectorAll('.agi-panel').forEach(function(p) { p.classList.remove('agi-panel-on'); });
      var panel = document.querySelector('.agi-panel[data-agi="' + index + '"]');
      if (panel) {
        panel.classList.add('agi-panel-on');
        if (content) content.scrollTop = 0;
      }
    }

    // ── Nav scroll effect ──
    const nav = document.getElementById('nav');
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    });

    // ── Made For sticky scroll words ──
    const madeForSection = document.getElementById('made-for-section');
    const madeForWords = document.querySelectorAll('.mf-word');

    function updateMadeForWords() {
      if (!madeForSection || !madeForWords.length) return;

      const rect = madeForSection.getBoundingClientRect();
      const totalHeight = madeForSection.clientHeight - window.innerHeight;
      if (totalHeight <= 0) return;

      const progress = Math.max(0, Math.min(1, Math.abs(rect.top) / totalHeight));
      const stepSize = 1 / madeForWords.length;

      madeForWords.forEach((word, index) => {
        const startTrigger = index * stepSize;
        const endTrigger = (index + 1) * stepSize;

        word.className = 'mf-word';

        if (progress >= startTrigger && progress < endTrigger) {
          word.classList.add('is-active');
        } else if (progress >= endTrigger) {
          word.classList.add('is-past');
        }
      });
    }

    updateMadeForWords();
    window.addEventListener('scroll', updateMadeForWords, { passive: true });
    window.addEventListener('resize', updateMadeForWords);

    // ── Scroll reveal ──
    const io = new IntersectionObserver(entries => {
            entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
    }, { threshold: 0.1 });

    document.querySelectorAll('.reveal').forEach(el => {
      const parent = el.closest('.features-grid,.steps,.plans-grid,.serve-grid,.stories,.testimonials-grid,.roles-strip');
      if (parent) {
        const siblings = parent.querySelectorAll('.reveal');
        const idx = Array.from(siblings).indexOf(el);
        el.style.transitionDelay = `${idx * 80}ms`;
      }
      io.observe(el);
    });

    // ── Animated stat counters ──
    const statIo = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const el = e.target;
        statIo.unobserve(el);

        // text stat (e.g. "Canada")
        if (el.dataset.text) { el.textContent = el.dataset.text; return; }
        // suffix stat (e.g. "100%")
        if (el.dataset.suffix) { el.textContent = el.textContent + el.dataset.suffix; return; }
        // number count-up
        const target = parseInt(el.dataset.target, 10);
        if (isNaN(target)) return;
        const duration = 1200;
        const start = performance.now();
        const tick = now => {
          const p = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(ease * target);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });

    document.querySelectorAll('.stat-num[data-target], .stat-num[data-text], .stat-num[data-suffix]').forEach(el => statIo.observe(el));

  
  
  (function() {
    // ── Wait for DOM ──
    const stage  = document.getElementById('agiStage');
    const ring   = document.getElementById('agi-cursor-ring');
    const dot    = document.getElementById('agi-cursor-dot');
    const canvas = document.getElementById('agi-blast-canvas');
    const wrap   = document.getElementById('agi-chaos-wrap');
    if (!stage || !ring || !dot || !canvas || !wrap) return;
    const ctx = canvas.getContext('2d');

    // ── Per-panel color palette ──
    const COLORS = [
      { hex:'#60A5FA', rgb:'96,165,250'  },  // 0 Education
      { hex:'#34D399', rgb:'52,211,153'  },  // 1 Life Skills
      { hex:'#F59E0B', rgb:'245,158,11'  },  // 2 Personal Support
      { hex:'#A78BFA', rgb:'167,139,250' },  // 3 Children
      { hex:'#F472B6', rgb:'244,114,182' },  // 4 Teenagers
      { hex:'#FB923C', rgb:'251,146,60'  },  // 5 Adults & Seniors
      { hex:'#22D3EE', rgb:'34,211,238'  },  // 6 Special Needs
    ];

    // ── Per-panel chaos objects ──
    // Each entry: { icon, label } — icon-only items have label:null
    const CHAOS = [
      // 0 Education
      [
        {icon:'✏️', label:'HOMEWORK DUE'}, {icon:'📚', label:'READ CH. 4'},
        {icon:'📐', label:'FRACTIONS'},    {icon:'🔢', label:'TIMES TABLES'},
        {icon:'📝', label:'ESSAY DUE'},    {icon:'⏰', label:'QUIZ TMRW'},
        {icon:'📖', label:'STUDY NOW'},    {icon:'🗒️', label:'SPELLING TEST'},
        {icon:'✏️', label:null},           {icon:'📐', label:null},
        {icon:'📚', label:null},           {icon:'🔢', label:null},
        {icon:'📝', label:null},           {icon:'⏰', label:null},
      ],
      // 1 Life Skills
      [
        {icon:'👋', label:'SAY HI'},       {icon:'👀', label:'EYE CONTACT'},
        {icon:'🎤', label:'SPEAK UP'},     {icon:'💬', label:'GROUP CHAT'},
        {icon:'🤝', label:'MAKE FRIENDS'}, {icon:'📱', label:'PHONE CALL'},
        {icon:'😶', label:'LUNCH ALONE'},  {icon:'🗣️', label:'SMALL TALK'},
        {icon:'👋', label:null},           {icon:'💬', label:null},
        {icon:'🤝', label:null},           {icon:'😶', label:null},
        {icon:'🎤', label:null},           {icon:'📱', label:null},
      ],
      // 2 Personal Support
      [
        {icon:'🧺', label:'LAUNDRY'},      {icon:'💸', label:'PAY BILLS'},
        {icon:'🦷', label:'DENTIST APPT'}, {icon:'🛒', label:'GROCERIES'},
        {icon:'🧹', label:'CLEAN HOUSE'},  {icon:'📋', label:'FILL FORMS'},
        {icon:'🍎', label:'MEAL PREP'},    {icon:'🍌', label:null},
        {icon:'🍊', label:null},           {icon:'🧺', label:null},
        {icon:'💸', label:null},           {icon:'🛒', label:null},
        {icon:'🧹', label:null},           {icon:'📋', label:'CALL BACK'},
      ],
      // 3 Children & Pre-Teens
      [
        {icon:'🚗', label:'PICKUP 3PM'},   {icon:'🍎', label:'SNACK TIME'},
        {icon:'👩‍👧', label:'PARENT MTG'},  {icon:'🎒', label:'LOST BACKPACK'},
        {icon:'🥪', label:'LUNCH PREP'},   {icon:'🚌', label:'FIELD TRIP'},
        {icon:'📄', label:'SCHOOL FORMS'}, {icon:'🤒', label:'SICK DAY'},
        {icon:'🍎', label:null},           {icon:'🥪', label:null},
        {icon:'🎒', label:null},           {icon:'🚗', label:null},
        {icon:'🍊', label:null},           {icon:'🍌', label:null},
      ],
      // 4 Teenagers
      [
        {icon:'📄', label:'RESUME'},       {icon:'🎓', label:'COLLEGE APPS'},
        {icon:'💼', label:'JOB SEARCH'},   {icon:'🚗', label:"DRIVER'S ED"},
        {icon:'📉', label:'GPA DROPPING'}, {icon:'😩', label:'BURNOUT'},
        {icon:'⏰', label:'DEADLINE'},     {icon:'💡', label:'STUDY HALL'},
        {icon:'📄', label:null},           {icon:'🎓', label:null},
        {icon:'💼', label:null},           {icon:'😩', label:null},
        {icon:'⏰', label:null},           {icon:'📉', label:null},
      ],
      // 5 Adults & Seniors
      [
        {icon:'📋', label:'WORKBC FORMS'}, {icon:'🏛️', label:'GOVT DOCS'},
        {icon:'💊', label:'MEDICATION'},   {icon:'✈️', label:'IMMIGRATION'},
        {icon:'🏦', label:'BANK APPT'},    {icon:'📄', label:'TAX RETURN'},
        {icon:'👴', label:'ISOLATION'},    {icon:'💸', label:'BENEFITS LAPSE'},
        {icon:'📋', label:null},           {icon:'💊', label:null},
        {icon:'💸', label:null},           {icon:'🏦', label:null},
        {icon:'📄', label:null},           {icon:'✈️', label:null},
      ],
      // 6 Special Needs
      [
        {icon:'📅', label:'CLBC MEETING'}, {icon:'📋', label:'DISABILITY FORM'},
        {icon:'✂️', label:'FUNDING CUT'},  {icon:'🩺', label:'THERAPY APPT'},
        {icon:'📢', label:'ADVOCACY'},     {icon:'⏳', label:'WAIT LIST'},
        {icon:'📞', label:'CRISIS LINE'},  {icon:'❌', label:'APPEAL DENIED'},
        {icon:'📅', label:null},           {icon:'⏳', label:null},
        {icon:'📋', label:null},           {icon:'🩺', label:null},
        {icon:'📢', label:null},           {icon:'📞', label:null},
      ],
    ];

    let curIdx   = 0;
    let curColor = COLORS[0];
    let ringX = 0, ringY = 0, mouseX = 0, mouseY = 0;
    let inStage  = false;
    const chips = [];
    const blasts = [];
    let spawnTimer = null;

    // ── Canvas resize ──
    function resizeCanvas() {
      canvas.width  = stage.offsetWidth;
      canvas.height = stage.offsetHeight;
    }
    resizeCanvas();
    new ResizeObserver(resizeCanvas).observe(stage);

    // ── Cursor tracking ──
    stage.addEventListener('mouseenter', () => {
      inStage = true;
      stage.classList.add('agi-stage-cursed');
      ring.classList.add('agi-c-live');
      dot.classList.add('agi-c-live');
    });
    stage.addEventListener('mouseleave', () => {
      inStage = false;
      stage.classList.remove('agi-stage-cursed');
      ring.classList.remove('agi-c-live');
      dot.classList.remove('agi-c-live');
    });
    document.addEventListener('mousemove', e => {
      mouseX = e.clientX; mouseY = e.clientY;
      dot.style.left = mouseX + 'px';
      dot.style.top  = mouseY + 'px';
    });
    (function loopRing() {
      ringX += (mouseX - ringX) * 0.11;
      ringY += (mouseY - ringY) * 0.11;
      ring.style.left = ringX + 'px';
      ring.style.top  = ringY + 'px';
      requestAnimationFrame(loopRing);
    })();

    // ── External hook called by switchAgi ──
    window._agiSetCursorColor = function(idx) {
      curIdx   = idx;
      curColor = COLORS[idx];
      const c  = curColor;
      dot.style.background   = c.hex;
      dot.style.boxShadow    = `0 0 8px ${c.hex}, 0 0 20px rgba(${c.rgb},0.7)`;
      ring.style.borderColor = `rgba(${c.rgb},0.7)`;
      ring.style.background  = `rgba(${c.rgb},0.04)`;
      clearChaos();
      startChaosSpawner(idx);
    };

    // ── Chaos chip spawning ──
    function clearChaos() {
      chips.forEach(c => { if (c.el.parentNode) c.el.parentNode.removeChild(c.el); });
      chips.length = 0;
      clearInterval(spawnTimer);
    }

    function spawnChip(idx) {
      const pool  = CHAOS[idx];
      const entry = pool[Math.floor(Math.random() * pool.length)];
      const c     = COLORS[idx];
      const sidebarEl = document.querySelector('.agi-sidebar');
      const SW    = sidebarEl ? sidebarEl.offsetWidth : 340;
      const W     = stage.offsetWidth - SW;   // width of the right content area
      const H     = stage.offsetHeight;
      const isIconOnly = !entry.label;

      // Edge spawn — coordinates relative to the wrap (0,0 = top-left of right area)
      const side = Math.floor(Math.random() * 4);
      let sx, sy;
      if      (side === 0) { sx = 10 + Math.random() * (W - 20); sy = -36; }
      else if (side === 1) { sx = W + 14;  sy = 40 + Math.random() * (H - 80); }
      else if (side === 2) { sx = 10 + Math.random() * (W - 20); sy = H + 36; }
      else                 { sx = -14;     sy = 40 + Math.random() * (H - 80); }

      // Target inside the right area
      const tx  = W * 0.06 + Math.random() * W * 0.88;
      const ty  = H * 0.08 + Math.random() * H * 0.84;
      const d   = Math.hypot(tx - sx, ty - sy) || 1;
      const spd = 0.28 + Math.random() * 0.44;
      const vx  = ((tx - sx) / d) * spd;
      const vy  = ((ty - sy) / d) * spd;
      const rotSpeed = (Math.random() - 0.5) * (isIconOnly ? 0.55 : 0.28);

      const el = document.createElement('div');

      if (isIconOnly) {
        // Big floating emoji
        const sizes = [28, 32, 36, 40, 44];
        const sz = sizes[Math.floor(Math.random() * sizes.length)];
        el.className = 'agi-icon';
        el.textContent = entry.icon;
        el.style.cssText = `
          left:${sx}px; top:${sy}px; opacity:0;
          font-size:${sz}px;
          filter: drop-shadow(0 0 8px rgba(${c.rgb},0.55)) drop-shadow(0 2px 4px rgba(0,0,0,0.4));
        `;
      } else {
        // Styled pill chip with emoji + label
        el.className = 'agi-chip';
        el.innerHTML = `<span style="font-size:14px;line-height:1">${entry.icon}</span><span>${entry.label}</span>`;
        el.style.cssText = `
          left:${sx}px; top:${sy}px; opacity:0;
          background: linear-gradient(135deg, rgba(${c.rgb},0.18) 0%, rgba(0,0,0,0.55) 100%);
          border: 1px solid rgba(${c.rgb},0.38);
          color: rgba(255,255,255,0.88);
          box-shadow: 0 0 14px rgba(${c.rgb},0.22), inset 0 1px 0 rgba(255,255,255,0.07);
          text-shadow: 0 1px 3px rgba(0,0,0,0.6);
        `;
      }

      wrap.appendChild(el);
      const obj = {
        el, x: sx, y: sy, vx, vy, rot: Math.random() * 360,
        rotSpeed, opacity: 0, life: 0,
        maxLife: 200 + Math.floor(Math.random() * 180),
        w: 0, h: 0, dead: false, isIconOnly
      };
      requestAnimationFrame(() => {
        obj.w = el.offsetWidth  || (isIconOnly ? 44 : 110);
        obj.h = el.offsetHeight || (isIconOnly ? 44 : 28);
      });
      chips.push(obj);
    }

    function startChaosSpawner(idx) {
      // Initial burst
      for (let i = 0; i < 6; i++) {
        setTimeout(() => spawnChip(idx), i * 350 + Math.random() * 200);
      }
      // Keep topping up
      spawnTimer = setInterval(() => {
        const alive = chips.filter(c => !c.dead).length;
        if (alive < 5) spawnChip(curIdx);
      }, 900);
    }

    // ── Main animation loop ──
    (function loop() {
      // -- Chaos chips --
      for (let i = chips.length - 1; i >= 0; i--) {
        const o = chips[i];
        if (o.dead) { chips.splice(i, 1); continue; }
        o.life++;
        o.x += o.vx; o.y += o.vy; o.rot += o.rotSpeed;
        // fade
        if      (o.life < 25)               o.opacity = o.life / 25;
        else if (o.life > o.maxLife - 25)    o.opacity = (o.maxLife - o.life) / 25;
        else                                 o.opacity = 1;
        if (o.life >= o.maxLife) {
          if (o.el.parentNode) o.el.parentNode.removeChild(o.el);
          o.dead = true; continue;
        }
        o.el.style.left      = o.x + 'px';
        o.el.style.top       = o.y + 'px';
        o.el.style.opacity   = o.opacity;
        o.el.style.transform = `rotate(${o.rot}deg)`;
      }

      // -- Blast particles --
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = blasts.length - 1; i >= 0; i--) {
        const p = blasts[i];
        p.life--;
        if (p.life <= 0) { blasts.splice(i, 1); continue; }
        const a = p.life / p.maxLife;
        p.x += p.vx; p.y += p.vy; p.vx *= 0.91; p.vy *= 0.91;

        if (p.type === 'ring') {
          p.r += p.expand;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(0, p.r), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${p.rgb},${a * 0.85})`;
          ctx.lineWidth   = a > 0.5 ? 2 : 1.2;
          ctx.stroke();

        } else if (p.type === 'beam') {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 5, p.y + p.vy * 5);
          ctx.strokeStyle = `rgba(${p.rgb},${a})`;
          ctx.lineWidth   = p.w;
          ctx.lineCap     = 'round';
          ctx.stroke();

          // Glow layer
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + p.vx * 5, p.y + p.vy * 5);
          ctx.strokeStyle = `rgba(255,255,255,${a * 0.35})`;
          ctx.lineWidth   = p.w * 0.4;
          ctx.stroke();

        } else {
          // Glow dot
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 2);
          grd.addColorStop(0,   `rgba(255,255,255,${a * 0.9})`);
          grd.addColorStop(0.3, `rgba(${p.rgb},${a})`);
          grd.addColorStop(1,   `rgba(${p.rgb},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
      }
      requestAnimationFrame(loop);
    })();

    // ── Click = shoot ──
    stage.addEventListener('click', e => {
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const rgb = curColor.rgb;

      // Ring pulse on cursor
      ring.style.width  = '58px'; ring.style.height = '58px';
      setTimeout(() => { ring.style.width = '36px'; ring.style.height = '36px'; }, 180);

      // Expanding rings (3)
      for (let ri = 0; ri < 3; ri++) {
        blasts.push({ type:'ring', x:cx, y:cy, r: 4 + ri * 7, expand: 5 + ri * 2.5,
          life: 26 - ri * 4, maxLife: 26 - ri * 4, vx:0, vy:0, rgb });
      }
      // Laser beams (14 rays)
      for (let b = 0; b < 14; b++) {
        const ang = (b / 14) * Math.PI * 2;
        const spd = 7 + Math.random() * 9;
        blasts.push({ type:'beam', x:cx, y:cy,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          life: 16 + Math.floor(Math.random() * 10), maxLife: 26, w: 1.2 + Math.random() * 0.8, rgb });
      }
      // Spark dots (22)
      for (let p = 0; p < 22; p++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 2 + Math.random() * 8;
        blasts.push({ type:'dot', x:cx, y:cy,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          r: 1.5 + Math.random() * 2, life: 18 + Math.floor(Math.random() * 20), maxLife: 38, rgb });
      }

      // Hit test chips — chip coords are relative to #agi-chaos-wrap (starts after sidebar)
      const sidebarW = (document.querySelector('.agi-sidebar') || {offsetWidth:340}).offsetWidth;
      const cxWrap = cx - sidebarW; // convert click x to wrap-relative coords
      chips.forEach(o => {
        if (o.dead) return;
        const ocx = o.x + (o.w || 70) / 2;
        const ocy = o.y + (o.h || 22) / 2;
        if (Math.hypot(ocx - cxWrap, ocy - cy) < 85) explodeChip(o, rgb);
      });
    });

    function explodeChip(o, rgb) {
      if (o.dead) return;
      o.dead = true;
      // Chip coords are wrap-relative; blast canvas is stage-relative — add sidebar offset
      const SW = (document.querySelector('.agi-sidebar') || {offsetWidth:340}).offsetWidth;
      const cx = o.x + (o.w || 70) / 2 + SW;
      const cy = o.y + (o.h || 22) / 2;
      // Flash white then remove
      o.el.style.transition = 'opacity 0.05s,background 0.04s,transform 0.08s';
      o.el.style.background = '#ffffff';
      o.el.style.color = '#111';
      o.el.style.transform = `rotate(${o.rot}deg) scale(1.4)`;
      setTimeout(() => { if (o.el.parentNode) o.el.parentNode.removeChild(o.el); }, 90);
      // Shrapnel burst
      for (let p = 0; p < 16; p++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 3 + Math.random() * 7;
        blasts.push({ type:'dot', x:cx, y:cy,
          vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
          r: 1.2 + Math.random() * 2.8, life: 14 + Math.floor(Math.random() * 14), maxLife: 28, rgb });
      }
      blasts.push({ type:'ring', x:cx, y:cy, r:3, expand:6, life:16, maxLife:16, vx:0, vy:0, rgb });
    }

    // Boot with Education
    startChaosSpawner(0);
  })();
  
  
  (function() {
    // Wait for sidebar to be rendered
    function init() {
      const sidebar = document.querySelector('.agi-sidebar');
      if (!sidebar) { setTimeout(init, 200); return; }

      /* ── Canvas overlay on sidebar ── */
      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:25;border-radius:inherit;overflow:hidden;';
      sidebar.appendChild(cv);
      const ctx = cv.getContext('2d');

      function resize() { cv.width = sidebar.offsetWidth; cv.height = sidebar.offsetHeight; }
      resize();
      new ResizeObserver(resize).observe(sidebar);

      /* ── Colors per button (matches cursor colors) ── */
      const C = [
        { h:'#60A5FA', r:'96,165,250'   },  // Education
        { h:'#34D399', r:'52,211,153'   },  // Life Skills
        { h:'#F59E0B', r:'245,158,11'   },  // Personal Support
        { h:'#A78BFA', r:'167,139,250'  },  // Children & Pre-Teens
        { h:'#F472B6', r:'244,114,182'  },  // Teenagers
        { h:'#FB923C', r:'251,146,60'   },  // Adults & Seniors
        { h:'#22D3EE', r:'34,211,238'   },  // Special Needs
      ];

      /* ── roundRect polyfill ── */
      if (!ctx.roundRect) {
        CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r) {
          this.moveTo(x+r,y);
          this.lineTo(x+w-r,y);   this.arcTo(x+w,y,   x+w,  y+r,   r);
          this.lineTo(x+w,y+h-r); this.arcTo(x+w,y+h, x+w-r,y+h,   r);
          this.lineTo(x+r,y+h);   this.arcTo(x,  y+h, x,    y+h-r, r);
          this.lineTo(x,y+r);     this.arcTo(x,  y,   x+r,  y,     r);
          this.closePath();
        };
      }

      /* ── Get a button's rect relative to sidebar ── */
      function bRect(btn) {
        const s = sidebar.getBoundingClientRect();
        const b = btn.getBoundingClientRect();
        const p = 3.5;
        return { x: b.left-s.left-p, y: b.top-s.top-p, w: b.width+p*2, h: b.height+p*2, r: 9 };
      }

      /* ── Point on perimeter of rounded rect at fraction t ── */
      function perimPt(rr, t) {
        const { x,y,w,h,r } = rr;
        const sH = Math.max(0, w - 2*r), sV = Math.max(0, h - 2*r);
        const qA = (Math.PI/2) * r;
        const total = 2*sH + 2*sV + 4*qA;
        let d = (((t % 1) + 1) % 1) * total;

        if (d < sH)  return { x: x+r+d,                           y: y          };  d -= sH;
        if (d < qA)  { const a=-Math.PI/2+(d/qA)*Math.PI/2; return { x: x+w-r+Math.cos(a)*r, y: y+r+Math.sin(a)*r }; } d -= qA;
        if (d < sV)  return { x: x+w,                             y: y+r+d      };  d -= sV;
        if (d < qA)  { const a=       (d/qA)*Math.PI/2; return { x: x+w-r+Math.cos(a)*r, y: y+h-r+Math.sin(a)*r }; } d -= qA;
        if (d < sH)  return { x: x+w-r-d,                         y: y+h        };  d -= sH;
        if (d < qA)  { const a=Math.PI/2+(d/qA)*Math.PI/2; return { x: x+r+Math.cos(a)*r,   y: y+h-r+Math.sin(a)*r }; } d -= qA;
        if (d < sV)  return { x: x,                               y: y+h-r-d    };  d -= sV;
        const a = Math.PI + (d/qA)*Math.PI/2;
        return { x: x+r+Math.cos(a)*r, y: y+r+Math.sin(a)*r };
      }

      /* ── Animation state ── */
      const SPEED = 0.0062; // fraction of perimeter per frame (~2.7 s/orbit at 60fps)
      const LAPS  = 1;      // orbits per button before hopping to next
      const TAIL  = 0.19;   // tail length as fraction of perimeter
      const SEGS  = 52;     // tail segments (more = smoother gradient)

      let orb  = 0;  // index of currently-orbiting button
      let t    = 0;  // position 0-1 along perimeter
      let laps = 0;  // completed full orbits on current button

      /* ── Main draw ── */
      function draw() {
        ctx.clearRect(0, 0, cv.width, cv.height);
        const btns = document.querySelectorAll('.agi-nav-item');
        if (!btns.length) return;

        /* Subtle resting border on non-orbiting buttons */
        btns.forEach((btn, i) => {
          if (i === orb) return;
          const rr = bRect(btn);
          ctx.beginPath();
          ctx.roundRect(rr.x, rr.y, rr.w, rr.h, rr.r);
          ctx.strokeStyle = `rgba(${C[i].r}, 0.2)`;
          ctx.lineWidth = 1;
          ctx.stroke();
        });

        /* Comet on active button */
        const btn = btns[orb];
        if (!btn) return;
        const col = C[orb];
        const rr  = bRect(btn);

        /* — Tail: gradient trail of dots — */
        for (let i = 0; i <= SEGS; i++) {
          const frac = i / SEGS;
          const pt   = perimPt(rr, t - (1 - frac) * TAIL);
          // Outer glow dot
          const glowR = 0.6 + frac * 3.2;
          const glowA = frac * 0.45;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, glowR * 2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col.r}, ${glowA})`;
          ctx.fill();
          // Core dot
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 0.5 + frac * 1.8, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col.r}, ${frac * 0.85})`;
          ctx.fill();
        }

        /* — Head: bright glowing orb — */
        const head = perimPt(rr, t);
        // Wide outer halo
        const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 11);
        halo.addColorStop(0,   'rgba(255,255,255,0.0)');
        halo.addColorStop(0.0, `rgba(${col.r},0.0)`);
        halo.addColorStop(0.1, `rgba(${col.r},0.6)`);
        halo.addColorStop(0.45,`rgba(${col.r},0.35)`);
        halo.addColorStop(1,   `rgba(${col.r},0)`);
        ctx.beginPath();
        ctx.arc(head.x, head.y, 11, 0, Math.PI*2);
        ctx.fillStyle = halo;
        ctx.fill();
        // Bright core glow
        const core = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 5);
        core.addColorStop(0,   'rgba(255,255,255,1)');
        core.addColorStop(0.4, `rgba(${col.r},1)`);
        core.addColorStop(1,   `rgba(${col.r},0)`);
        ctx.beginPath();
        ctx.arc(head.x, head.y, 5, 0, Math.PI*2);
        ctx.fillStyle = core;
        ctx.fill();
        // Pure white pinpoint
        ctx.beginPath();
        ctx.arc(head.x, head.y, 1.5, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }

      /* ── Animation loop ── */
      function loop() {
        t += SPEED;
        if (t >= 1) {
          t -= 1;
          laps += 1;
          if (laps >= LAPS) {
            laps = 0;
            orb = (orb + 1) % C.length;
            t = 0;
          }
        }
        draw();
        requestAnimationFrame(loop);
      }

      loop();
    }

    setTimeout(init, 400);
  })();
