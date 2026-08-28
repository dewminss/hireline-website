const { useState, useEffect, useRef } = React;

/* ======================================================================
   "DATABASE" LAYER
   Everything is stored in the browser's localStorage so data survives a
   refresh / closing the tab  there's no separate backend server, which
   is deliberate so this file can be opened directly, with no install
   step, on any machine.
   ====================================================================== */

const KEYS = {
  users: "hl_users",
  jobs: "hl_jobs",
  // Everyone who submits a CV through the public Apply form is an
  // "Applicant" (raw pool, includes their AI match score for HR's eyes
  // only). HR manually promotes the strong ones into "Candidates"  a
  // separate, smaller shortlist with its own search/sort/pin/delete.
  applicants: "hl_applicants",
  candidates: "hl_candidates_shortlist",
  interviews: "hl_interviews",
  feedback: "hl_feedback",
  decisions: "hl_decisions",
  messages: "hl_contact_messages",
  session: "hl_session",
  seeded: "hl_seeded_v3",
};

function load(key) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
  catch { return []; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function uid(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }


/* CV files are stored separately in IndexedDB so large PDFs do not fill localStorage. */
const CV_DB_NAME = "hl_cv_files";
const CV_STORE = "files";
function openCVDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(CV_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CV_STORE)) db.createObjectStore(CV_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function saveCVFile(file, fileId) {
  const db = await openCVDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CV_STORE, "readwrite");
    tx.objectStore(CV_STORE).put(file, fileId);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
  });
}
async function getCVFile(fileId) {
  if (!fileId) return null;
  const db = await openCVDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CV_STORE, "readonly");
    const req = tx.objectStore(CV_STORE).get(fileId);
    req.onsuccess = () => { db.close(); resolve(req.result || null); };
    req.onerror = () => { const err = req.error; db.close(); reject(err); };
  });
}
async function deleteAllCVFiles() {
  const db = await openCVDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CV_STORE, "readwrite");
    tx.objectStore(CV_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { const err = tx.error; db.close(); reject(err); };
  });
}
async function downloadCV(record) {
  try {
    let url = record.resumeFileData || null; // legacy records remain supported
    if (!url && record.resumeFileId) {
      const blob = await getCVFile(record.resumeFileId);
      if (blob) url = URL.createObjectURL(blob);
    }
    if (!url) { alert("CV file was not found in this browser."); return; }
    const a = document.createElement("a"); a.href = url; a.download = record.resumeFileName || "cv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (record.resumeFileId && !record.resumeFileData) setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { console.error(e); alert("Unable to download the CV file."); }
}

async function viewCV(record) {
  // Open the tab synchronously, in direct response to the click, so the
  // browser's popup blocker never sees a "window.open after an await" and
  // blocks it (which otherwise results in a blank about:blank#blocked tab).
  const newTab = window.open("", "_blank");
  if (!newTab) {
    alert("Please allow pop-ups for this site to view the CV.");
    return;
  }
  try {
    let url = record.resumeFileData || null; // legacy records remain supported
    let objectUrl = false;
    if (!url && record.resumeFileId) {
      const blob = await getCVFile(record.resumeFileId);
      if (blob) { url = URL.createObjectURL(blob); objectUrl = true; }
    }
    if (!url) {
      newTab.close();
      alert("CV file was not found in this browser.");
      return;
    }
    newTab.location.href = url;
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    console.error(e);
    newTab.close();
    alert("Unable to open the CV file.");
  }
}


const STATUS_OPTIONS = ["Applied", "Shortlisted", "Interview Scheduled", "Interviewed", "Offered", "Rejected", "Hired"];
const RAIL_STAGES = ["Applied", "Shortlisted", "Interview", "Offer", "Hired"];

function stageIndex(status) {
  if (status === "Applied") return 0;
  if (status === "Shortlisted") return 1;
  if (status === "Interview Scheduled" || status === "Interviewed") return 2;
  if (status === "Offered") return 3;
  if (status === "Hired") return 4;
  if (status === "Rejected") return -1;
  return 0;
}

/* ---- one-time sample data so the site isn't empty on first open ---- */
function seedIfNeeded() {
  if (localStorage.getItem(KEYS.seeded)) return;

  const jobs = [
    {
      id: uid("job"), title: "Software Engineer", department: "Engineering",
      description: "Build and maintain features across our web-based recruitment platform, working closely with designers, QA and product to ship reliable releases.",
      requirements: "Experience with JavaScript, React, Node.js, REST APIs and SQL databases. Comfortable with Git and agile teamwork.",
      status: "open", createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    },
    {
      id: uid("job"), title: "QA Engineer", department: "Engineering",
      description: "Own the quality of new features before release: design test cases, run manual and automated checks, and track down the root cause of bugs.",
      requirements: "Experience with manual and automated testing, test case design, bug tracking tools and basic SQL for verifying data.",
      status: "open", createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    },
    {
      id: uid("job"), title: "UI/UX Designer", department: "Product & Design",
      description: "Design clear, usable interfaces for our recruitment platform, from candidate-facing job pages to internal HR dashboards.",
      requirements: "Experience with Figma, user research, wireframing and usability testing. A strong portfolio and attention to accessibility.",
      status: "open", createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
    },
    {
      id: uid("job"), title: "HR Executive", department: "Human Resources",
      description: "Manage job postings, coordinate candidate communication end-to-end, and support the interview scheduling process for hiring teams.",
      requirements: "Experience in recruitment or HR administration, strong written communication, and familiarity with applicant tracking tools.",
      status: "open", createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    },
    {
      id: uid("job"), title: "Data Analyst", department: "Business Intelligence",
      description: "Turn recruitment data into insights: build reporting dashboards, track hiring funnel metrics, and flag bottlenecks in the pipeline.",
      requirements: "Experience with SQL, spreadsheet modelling, and data visualization tools. Comfortable presenting findings to non-technical teams.",
      status: "open", createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    },
    {
      id: uid("job"), title: "Customer Support Executive", department: "Operations",
      description: "Be the first point of contact for candidates and client companies using the platform, resolving account and application queries.",
      requirements: "Excellent communication skills, patience under pressure, and basic familiarity with ticketing/helpdesk software.",
      status: "open", createdAt: new Date(Date.now() - 86400000).toISOString(),
    },
  ];

  // Demo staff accounts, pre-loaded so the login page works right away.
  // In a real product these would not exist  a live company would have
  // everyone register their own account (see the Register page).
  const users = [
    { id: uid("user"), name: "Hansi Perera", email: "hr@Altrium.test", password: "hr12345", role: "hr" },
    { id: uid("user"), name: "Nimal Fernando", email: "interviewer@Altrium.test", password: "interview123", role: "interviewer" },
    { id: uid("user"), name: "Amanda Silva", email: "manager@Altrium.test", password: "manager123", role: "manager" },
  ];

  save(KEYS.jobs, jobs);
  save(KEYS.users, users);
  save(KEYS.applicants, []);
  save(KEYS.candidates, []);
  save(KEYS.interviews, []);
  save(KEYS.feedback, []);
  save(KEYS.decisions, []);
  save(KEYS.messages, []);
  localStorage.setItem(KEYS.seeded, "true");
}

async function resetAllData() {
  Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  try { await deleteAllCVFiles(); } catch (e) { console.warn("Could not clear CV database", e); }
  seedIfNeeded();
  window.location.reload();
}

/* ======================================================================
   "AI" CV MATCHING ENGINE (simulated  not a real AI/ML model, no API
   calls). It builds a weighted vocabulary from the job posting (words
   in "requirements" count more than general description words) and
   compares it to the candidate's CV text using cosine similarity of
   term-frequency vectors. The score is computed fresh from whatever
   text is in the job posting and the CV  there is no fixed/hardcoded
   score table, so every job/CV pair produces a genuinely different,
   calculated result.
   ====================================================================== */

const STOPWORDS = new Set([
  "the","and","for","are","with","you","your","our","will","have","has","that","this","from",
  "into","able","who","can","all","any","not","but","was","were","been","being","such","than",
  "then","them","they","their","there","here","what","when","where","which","while","about",
  "above","after","again","against","each","few","more","most","other","some","own","same",
  "should","would","could","also","etc","job","role","position","work","working","company",
  "team","candidate","candidates","applicant","applicants","must","need","needed","including",
  "include","includes","years","year","using","use","used","within","well","good","strong",
  "ability","responsibilities","requirements","responsible","experience",
]);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, " ").split(/\s+/)
    .map((w) => w.trim().replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}
function buildJobVocabulary(description, requirements) {
  const weights = {};
  tokenize(description).forEach((w) => (weights[w] = (weights[w] || 0) + 1));
  tokenize(requirements).forEach((w) => (weights[w] = (weights[w] || 0) + 2.5));
  return weights;
}
function analyzeMatch(description, requirements, resumeText) {
  const jobWeights = buildJobVocabulary(description, requirements);
  const jobVocab = Object.keys(jobWeights);
  const resumeTokens = tokenize(resumeText);
  const resumeTF = {};
  resumeTokens.forEach((t) => (resumeTF[t] = (resumeTF[t] || 0) + 1));
  if (jobVocab.length === 0 || resumeTokens.length === 0) {
    return { score: 0, matchedKeywords: [], missingKeywords: jobVocab.slice(0, 8) };
  }
  let dot = 0, jobMag = 0, resumeMag = 0;
  jobVocab.forEach((term) => {
    const jobVal = jobWeights[term];
    const resumeVal = resumeTF[term] ? 1 + Math.log(resumeTF[term]) : 0;
    dot += jobVal * resumeVal; jobMag += jobVal * jobVal; resumeMag += resumeVal * resumeVal;
  });
  let cosine = 0;
  if (jobMag > 0 && resumeMag > 0) cosine = dot / (Math.sqrt(jobMag) * Math.sqrt(resumeMag));
  const score = Math.round(Math.min(1, cosine) * 100);
  const sorted = [...jobVocab].sort((a, b) => jobWeights[b] - jobWeights[a]);
  return {
    score,
    matchedKeywords: sorted.filter((t) => resumeTF[t]).slice(0, 8),
    missingKeywords: sorted.filter((t) => !resumeTF[t]).slice(0, 8),
  };
}


/* ======================================================================
   AI-ASSISTED CV-TO-CV COMPARISON
   Compares each candidate CV with the other CVs for the selected job.
   The score is the average cosine similarity against the selected job's
   candidate pool. It does not replace the existing job-requirements match.
   ====================================================================== */
function analyzeCVToCVSimilarity(resumeTextA, resumeTextB) {
  const aTokens = tokenize(resumeTextA);
  const bTokens = tokenize(resumeTextB);
  if (!aTokens.length || !bTokens.length) return 0;

  const aTF = {}, bTF = {};
  aTokens.forEach((t) => (aTF[t] = (aTF[t] || 0) + 1));
  bTokens.forEach((t) => (bTF[t] = (bTF[t] || 0) + 1));

  const vocabulary = new Set([...Object.keys(aTF), ...Object.keys(bTF)]);
  let dot = 0, aMag = 0, bMag = 0;
  vocabulary.forEach((term) => {
    const aVal = aTF[term] ? 1 + Math.log(aTF[term]) : 0;
    const bVal = bTF[term] ? 1 + Math.log(bTF[term]) : 0;
    dot += aVal * bVal;
    aMag += aVal * aVal;
    bMag += bVal * bVal;
  });

  if (!aMag || !bMag) return 0;
  return Math.round((dot / (Math.sqrt(aMag) * Math.sqrt(bMag))) * 100);
}

function calculatePeerCVScores(records, selectedJobId) {
  const pool = records.filter((r) => r.jobId === selectedJobId && r.resumeText);
  const scores = {};
  pool.forEach((candidate) => {
    const others = pool.filter((other) => other.id !== candidate.id);
    if (!others.length) {
      scores[candidate.id] = 0;
      return;
    }
    const total = others.reduce(
      (sum, other) => sum + analyzeCVToCVSimilarity(candidate.resumeText, other.resumeText),
      0
    );
    scores[candidate.id] = Math.round(total / others.length);
  });
  return scores;
}

/* ======================================================================
   CV FILE HANDLING  read the actual uploaded PDF/DOCX/TXT so the AI
   matcher has real text to work with, and keep the original file
   (as a data URL) so staff can view/download it later.
   ====================================================================== */

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function extractTextFromFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  try {
    if (ext === "txt") {
      return await file.text();
    }
    if (ext === "pdf" && window.pdfjsLib) {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((it) => it.str).join(" ") + "\n";
      }
      return text.trim();
    }
    if (ext === "docx" && window.mammoth) {
      const buf = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      return (result.value || "").trim();
    }
  } catch (e) {
    console.error("CV text extraction failed:", e);
  }
  return ""; // unsupported type (e.g. old .doc) or extraction failed
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename || "cv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ======================================================================
   SESSION HELPERS
   ====================================================================== */
function getSession() { try { const raw = localStorage.getItem(KEYS.session); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function setSession(user) { localStorage.setItem(KEYS.session, JSON.stringify(user)); }
function clearSession() { localStorage.removeItem(KEYS.session); }

/* ======================================================================
   ICONS (small inline SVGs  no external image files needed)
   ====================================================================== */
const Icon = {
  Rail: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h16M4 12a2 2 0 100-4 2 2 0 000 4zM12 12a2 2 0 100-4 2 2 0 000 4zM20 12a2 2 0 100-4 2 2 0 000 4z"/></svg>
  ),
  Mail: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>),
  Pin: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>),
  Phone: () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3 19.5 19.5 0 01-6-6 19.8 19.8 0 01-3-8.7A2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .3 2 .6 3a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.2-1.2a2 2 0 012.1-.5c1 .3 2 .5 3 .6a2 2 0 011.7 2.1z"/></svg>),
};

/* ======================================================================
   SHARED COMPONENTS
   ====================================================================== */

function Navbar({ user, onLogout, navigate, page }) {
  const dashPath = !user ? "home" : user.role === "hr" ? "hr" : user.role === "interviewer" ? "interviewer" : "manager";
  const isPublicNav = ["home", "careers", "about", "contact", "jobDetails"].includes(page);
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a className="brand" onClick={() => navigate("home")}>
          <span className="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 12h16M4 12a2 2 0 100-4 2 2 0 000 4zM12 12a2 2 0 100-4 2 2 0 000 4zM20 12a2 2 0 100-4 2 2 0 000 4z"/></svg></span>
          Altrium
        </a>
        {isPublicNav && (
          <nav className="nav-links">
            <a className={page === "home" ? "current" : ""} onClick={() => navigate("home")}>Home</a>
            <a className={page === "careers" ? "current" : ""} onClick={() => navigate("careers")}>Open Positions</a>
            <a className={page === "about" ? "current" : ""} onClick={() => navigate("about")}>About Us</a>
            <a className={page === "contact" ? "current" : ""} onClick={() => navigate("contact")}>Contact</a>
          </nav>
        )}
        <div className="nav-right">
          {user ? (
            <>
              <a className="nav-link" onClick={() => navigate(dashPath)} style={{ fontWeight: 600, fontSize: "0.88rem" }}>My Dashboard</a>
              <span className="nav-user">{user.name}<span className="role-tag">{user.role}</span></span>
              <button className="btn btn-outline btn-sm" onClick={onLogout}>Logout</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => navigate("login")}>Login</button>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer({ navigate }) {
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <div className="brand" style={{ marginBottom: 10 }}>
            <span className="brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 12h16M4 12a2 2 0 100-4 2 2 0 000 4zM12 12a2 2 0 100-4 2 2 0 000 4zM20 12a2 2 0 100-4 2 2 0 000 4z"/></svg></span>
            Altrium
          </div>
          <p>A single, clear rail from first application to final offer  built so hiring teams and candidates always know exactly where things stand.</p>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <a onClick={() => navigate("about")}>About Us</a>
          <a onClick={() => navigate("careers")}>Open Positions</a>
          <a onClick={() => navigate("contact")}>Contact</a>
        </div>
        <div className="footer-col">
          <h4>For Hiring Teams</h4>
          <a onClick={() => navigate("login")}>Staff Login</a>
          <a onClick={() => navigate("register")}>Create Staff Account</a>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} Altrium</span>
        <a onClick={() => { if (window.confirm("This erases all saved data (jobs, candidates, accounts, interviews) and restores the starting sample jobs. Continue?")) resetAllData(); }}>Reset demo data</a>
      </div>
    </footer>
  );
}

/* Pipeline rail  the site's signature visual device. Shown large in the
   hero (generic stages) and small next to every candidate (their actual
   current stage), so it always represents something real. */
function PipelineRail({ currentIndex, rejected, mini, showLabels }) {
  return (
    <div className={mini ? "rail-wrap" : "rail-wrap"}>
      <div className={"rail" + (mini ? " rail-mini" : "")}>
        {RAIL_STAGES.map((stage, i) => {
          const done = !rejected && i <= currentIndex;
          const isCurrent = !rejected && i === currentIndex;
          const cls = "rail-step" + (done ? " done" : "") + (isCurrent ? " current" : "") + (rejected ? " rejected" : "");
          return (
            <div className={cls} key={stage}>
              <div className="rail-dot" title={stage}></div>
              {i < RAIL_STAGES.length - 1 && <div className="rail-line"></div>}
            </div>
          );
        })}
      </div>
      {showLabels && !mini && (
        <div className="rail-labels">
          {RAIL_STAGES.map((s) => <span key={s}>{s}</span>)}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, navigate }) {
  const applicantCount = load(KEYS.applicants).filter((a) => a.jobId === job.id).length;
  const daysAgo = Math.max(0, Math.round((Date.now() - new Date(job.createdAt).getTime()) / 86400000));
  return (
    <div className="card job-card">
      <div className="job-card-top">
        <h3>{job.title}</h3>
        <span className="dept-tag">{job.department || "General"}</span>
      </div>
      <p className="job-desc">{job.description.slice(0, 130)}{job.description.length > 130 ? "…" : ""}</p>
      <div className="job-card-foot">
        <span>{daysAgo === 0 ? "Posted today" : `Posted ${daysAgo}d ago`} · {applicantCount} applicant{applicantCount === 1 ? "" : "s"}</span>
      </div>
      <button className="btn btn-primary btn-block" onClick={() => navigate("jobDetails", { jobId: job.id })}>View role &amp; apply</button>
    </div>
  );
}

/* ======================================================================
   HOME (hero + featured jobs + stats)
   ====================================================================== */

function Home({ navigate }) {
  const jobs = load(KEYS.jobs).filter((j) => j.status === "open");
  const featured = jobs.slice(0, 3);

  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow"><span className="eyebrow-dot"></span>Altrium · JOIN WITH US</span>
            <h1>Hire with clarity, from first application to final offer.</h1>
            <p className="lede">Altrium keeps job postings, candidates, interviews and hiring decisions on one rail  so HR, interviewers and hiring managers are always looking at the same picture.</p>
            <div className="hero-ctas">
              <button className="btn btn-primary" onClick={() => navigate("careers")}>View open positions</button>
              <button className="btn btn-outline" onClick={() => navigate("about")}>How it works</button>
            </div>
            <PipelineRail currentIndex={2} showLabels />
          </div>
          <div className="hero-stack">
            {featured[0] && (
              <div className="stack-card c1">
                <div className="stack-title">{featured[0].title}</div>
                <div className="stack-meta"><span>{featured[0].department}</span><span className="stack-pill">Open</span></div>
              </div>
            )}
            {featured[1] && (
              <div className="stack-card c2">
                <div className="stack-title">{featured[1].title}</div>
                <div className="stack-meta"><span>{featured[1].department}</span><span className="stack-pill">Open</span></div>
              </div>
            )}
            {featured[2] && (
              <div className="stack-card c3">
                <div className="stack-title">{featured[2].title}</div>
                <div className="stack-meta"><span>{featured[2].department}</span><span className="stack-pill">Open</span></div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="container page-section">
        <div className="section-head">
          <div>
            <h2>Featured openings</h2>
            <p className="sub">A few of our current roles  no account needed to apply.</p>
          </div>
          <a onClick={() => navigate("careers")} style={{ fontWeight: 600 }}>View all open positions →</a>
        </div>
        {featured.length === 0 && <p className="empty-state">There are no open positions right now. Please check back soon.</p>}
        <div className="job-grid">
          {featured.map((job) => <JobCard key={job.id} job={job} navigate={navigate} />)}
        </div>
      </section>
    </>
  );
}

function Careers({ navigate }) {
  const jobs = load(KEYS.jobs).filter((j) => j.status === "open");
  const [dept, setDept] = useState("");
  const depts = [...new Set(jobs.map((j) => j.department).filter(Boolean))];
  const visible = jobs.filter((j) => !dept || j.department === dept);

  return (
    <div className="container page-section">
      <div className="section-head">
        <div>
          <h2>Open Positions</h2>
          <p className="sub">{jobs.length} role{jobs.length === 1 ? "" : "s"} open across Altrium. Apply directly  no account required.</p>
        </div>
        {depts.length > 1 && (
          <label className="inline-filter">Department:
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="">All departments</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
      </div>
      {visible.length === 0 && <p className="empty-state">No open positions match that filter right now.</p>}
      <div className="job-grid">
        {visible.map((job) => <JobCard key={job.id} job={job} navigate={navigate} />)}
      </div>
    </div>
  );
}

/* ======================================================================
   ABOUT / CONTACT
   ====================================================================== */

function About() {
  return (
    <div className="container page-section">
      <span className="eyebrow"><span className="eyebrow-dot"></span>ABOUT Altrium</span>
      <h2 style={{ fontSize: "2.1rem", maxWidth: "20ch" }}>One rail, from application to offer letter.</h2>
      <p style={{ maxWidth: "62ch", fontSize: "1.02rem" }}>
        Altrium is a fictional company built for a university group project (COMP50074  Professional
        Practice and Project Management). It's a recruitment &amp; hiring tracker: a single place for HR to
        post roles, for candidates to apply without creating an account, for interviewers to leave structured
        feedback, and for hiring managers to make the final call  all tracked along the same pipeline rail.
      </p>

      <div className="value-grid">
        <div className="value-card">
          <div className="icon">01</div>
          <h3 style={{ fontSize: "1rem" }}>Transparent pipeline</h3>
          <p>Every candidate sits at a visible stage  Applied, Shortlisted, Interview, Offer or Hired  so nobody has to ask "where are we with this one?"</p>
        </div>
        <div className="value-card">
          <div className="icon">02</div>
          <h3 style={{ fontSize: "1rem" }}>Faster shortlisting</h3>
          <p>An automated CV-matching score gives recruiters a starting point, calculated fresh from each job's real requirements  never a fixed formula.</p>
        </div>
        <div className="value-card">
          <div className="icon">03</div>
          <h3 style={{ fontSize: "1rem" }}>Structured feedback</h3>
          <p>Interviewers rate and recommend candidates in a consistent format, so hiring managers can compare people fairly, side by side.</p>
        </div>
      </div>

      <hr className="divider" />

      
     
      
        
        
      
    </div>
  );
}

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);

  function submit(e) {
    e.preventDefault();
    const all = load(KEYS.messages);
    all.push({ id: uid("msg"), ...form, sentAt: new Date().toISOString() });
    save(KEYS.messages, all);
    setSent(true);
  }

  return (
    <div className="container page-section">
      <span className="eyebrow"><span className="eyebrow-dot"></span>GET IN TOUCH</span>
      <h2 style={{ fontSize: "2rem" }}>Questions about a role or your application?</h2>
      <div className="contact-grid" style={{ marginTop: 30 }}>
        <div>
          <div className="contact-info-item">
            <div className="ic"><Icon.Mail /></div>
            <div><h4>Email</h4><p>careers@Altrium@gmail.com</p></div>
          </div>
          <div className="contact-info-item">
            <div className="ic"><Icon.Phone /></div>
            <div><h4>Phone</h4><p>+94 76 786 0064</p></div>
          </div>
          <div className="contact-info-item">
            <div className="ic"><Icon.Pin /></div>
            <div><h4>Office</h4><p>Negombo, Western Province, Sri Lanka</p></div>
          </div>
          <p className="muted-small">We'll get back to you as soon as possible</p>
        </div>
        <div className="card">
          {sent ? (
            <div>
              <h3 style={{ color: "var(--success)" }}>Message sent</h3>
              <p>Thanks, {form.name || "there"}  your message has been saved. We'll get back to you soon.</p>
              <button className="btn btn-outline btn-sm" onClick={() => { setSent(false); setForm({ name: "", email: "", message: "" }); }}>Send another message</button>
            </div>
          ) : (
            <form className="form" onSubmit={submit}>
              <label>Full Name *<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label>Email *<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label>Message *<textarea required rows="5" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
              <button className="btn btn-primary" type="submit">Send message</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   JOB DETAILS + APPLY (public, no login)  with real CV upload
   ====================================================================== */

function JobDetails({ jobId, navigate }) {
  const job = load(KEYS.jobs).find((j) => j.id === jobId);
  const [form, setForm] = useState({ name: "", email: "", phone: "", cover_note: "", resume_text: "" });
  const [file, setFile] = useState(null);
  const [fileDataUrl, setFileDataUrl] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState("");
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErrors((er) => ({ ...er, file: "" }));
    if (f.size > 20 * 1024 * 1024) {
      setErrors((er) => ({ ...er, file: "Please choose a file under 20MB." }));
      return;
    }
    setFile(f);
    setExtracting(true);
    setExtractNote("Reading your CV…");
    try {
      const text = await extractTextFromFile(f);
      if (text && text.length > 20) {
        update("resume_text", text);
        setExtractNote("CV text extracted automatically from " + f.name + ". You can edit it below if needed.");
      } else {
        setExtractNote("Couldn't automatically read text from this file type. Please paste your CV text in the box below.");
      }
    } catch (err) {
      setExtractNote("Couldn't automatically read this file. Please paste your CV text in the box below.");
    } finally {
      setExtracting(false);
    }
  }

  function validate() {
    const er = {};
    if (!form.name.trim()) er.name = "Full name is required.";
    if (!form.email.trim()) er.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) er.email = "Enter a valid email address.";
    if (!form.phone.trim()) er.phone = "Phone number is required.";
    if (!form.cover_note.trim()) er.cover_note = "A short cover note is required.";
    if (!file) er.file = "Please attach your CV file (PDF, DOCX or TXT).";
    if (!form.resume_text || form.resume_text.trim().length < 20) {
      er.resume_text = "CV text is required (at least 20 characters)  paste it here if it wasn't extracted automatically.";
    }
    return er;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length > 0) return;

    setSubmitting(true);
    try {
      const { score, matchedKeywords, missingKeywords } = analyzeMatch(job.description, job.requirements, form.resume_text);
      const fileId = uid("cv");
      await saveCVFile(file, fileId);
      const applicants = load(KEYS.applicants);
      const applicant = {
        id: uid("app"), jobId: job.id, name: form.name, email: form.email, phone: form.phone,
        coverNote: form.cover_note, resumeText: form.resume_text,
        resumeFileName: file.name, resumeFileType: file.type, resumeFileId: fileId,
        matchScore: score, matchedKeywords, missingKeywords, status: "Applied", appliedAt: new Date().toISOString(),
      };
      applicants.push(applicant);
      save(KEYS.applicants, applicants);
      setResult(applicant);
    } catch (err) {
      console.error("Application submission failed:", err);
      setErrors((x) => ({ ...x, submit: "Could not save your application. Please try again." }));
    } finally {
      setSubmitting(false);
    }
  }

  if (!job) {
    return (
      <div className="container page-section">
        <p className="error-text">Job not found.</p>
        <a onClick={() => navigate("careers")}>← Back to open positions</a>
      </div>
    );
  }

  return (
    <div className="container narrow page-section">
      <a className="back-link" onClick={() => navigate("careers")}>← Back to all jobs</a>
      <span className="dept-tag">{job.department || "General"}</span>
      <h1 style={{ marginTop: 10 }}>{job.title}</h1>

      <section className="detail-block"><h3>About this role</h3><p>{job.description}</p></section>
      <section className="detail-block"><h3>Requirements</h3><p>{job.requirements}</p></section>
      <hr className="divider" />

      {result ? (
        <div className="card success-card">
          <h3>Application submitted!</h3>
          <p>Thanks, {result.name}. We've received your application for {job.title}. Our hiring team will review it and be in touch if you're shortlisted.</p>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => navigate("careers")}>Browse more roles</button>
        </div>
      ) : (
        <>
          <h3>Apply for this position</h3>
          <form className="form" onSubmit={handleSubmit} noValidate>
            <div className="form-row">
              <label>Full Name *
                <input value={form.name} onChange={(e) => update("name", e.target.value)} />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </label>
              <label>Email *
                <input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
                {errors.email && <span className="field-error">{errors.email}</span>}
              </label>
            </div>
            <label>Phone *
              <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
              {errors.phone && <span className="field-error">{errors.phone}</span>}
            </label>
            <label>Cover Note *
              <textarea rows="3" value={form.cover_note} onChange={(e) => update("cover_note", e.target.value)} />
              {errors.cover_note && <span className="field-error">{errors.cover_note}</span>}
            </label>

            <label>Attach your CV *
              <span className="hint">PDF, DOCX or TXT  under 4MB. We'll read it automatically for our records.</span>
              <div className="file-drop">
                <input type="file" accept=".pdf,.doc,.docx,.txt" onChange={handleFile} />
                {extractNote && <p className={"file-status " + (extracting ? "" : (form.resume_text ? "ok" : "warn"))}>{extracting ? "Reading your CV…" : extractNote}</p>}
              </div>
              {errors.file && <span className="field-error">{errors.file}</span>}
            </label>

            <label>CV text *
              <textarea rows="8" placeholder="Attach a CV above, or paste your CV text here manually." value={form.resume_text} onChange={(e) => update("resume_text", e.target.value)} />
              {errors.resume_text && <span className="field-error">{errors.resume_text}</span>}
            </label>

            <button className="btn btn-primary" type="submit" disabled={submitting || extracting}>
              {submitting ? "Submitting…" : "Submit Application"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

/* ======================================================================
   LOGIN / REGISTER (company staff only)
   ====================================================================== */

function Login({ navigate, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e) {
    e.preventDefault();
    const users = load(KEYS.users);
    const user = users.find((u) => u.email === email.toLowerCase() && u.password === password);
    if (!user) { setError("Incorrect email or password."); return; }
    const { password: _pw, ...safeUser } = user;
    onLogin(safeUser);
    navigate(safeUser.role === "hr" ? "hr" : safeUser.role === "interviewer" ? "interviewer" : "manager");
  }

  return (
    <div className="container narrow page-section">
      <span className="eyebrow"><span className="eyebrow-dot"></span>STAFF ACCESS</span>
      <h1 style={{ fontSize: "2rem" }}>Company Login</h1>
      <p>For HR, Interviewers and Hiring Managers. Candidates never need an account to apply.</p>
      <div className="card">
        <form className="form" onSubmit={handleSubmit}>
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block" type="submit">Login</button>
        </form>
      </div>
      <p style={{ marginTop: 16 }}>Don't have a staff account yet? <a onClick={() => navigate("register")}>Register here</a>.</p>
    </div>
  );
}

function Register({ navigate, onLogin }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "hr" });
  const [error, setError] = useState("");

  function update(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (form.password.length < 6) { setError("Password must be at least 6 characters."); return; }
    const users = load(KEYS.users);
    if (users.some((u) => u.email === form.email.toLowerCase())) { setError("An account with that email already exists."); return; }
    const newUser = { id: uid("user"), name: form.name, email: form.email.toLowerCase(), password: form.password, role: form.role };
    users.push(newUser);
    save(KEYS.users, users);
    const { password: _pw, ...safeUser } = newUser;
    onLogin(safeUser);
    navigate(form.role === "hr" ? "hr" : form.role === "interviewer" ? "interviewer" : "manager");
  }

  return (
    <div className="container narrow page-section">
      <span className="eyebrow"><span className="eyebrow-dot"></span>STAFF ACCESS</span>
      <h1 style={{ fontSize: "2rem" }}>Staff Registration</h1>
      <p>Create an account for HR, Interviewer or Hiring Manager access. No demo accounts are pre-loaded  your team creates its own.</p>
      <div className="card">
        <form className="form" onSubmit={handleSubmit}>
          <label>Full Name<input required value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
          <label>Email<input required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} /></label>
          <label>Password (min 6 characters)<input required type="password" minLength="6" value={form.password} onChange={(e) => update("password", e.target.value)} /></label>
          <label>Role
            <select value={form.role} onChange={(e) => update("role", e.target.value)}>
              <option value="hr">HR</option>
              <option value="interviewer">Interviewer</option>
              <option value="manager">Hiring Manager</option>
            </select>
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-block" type="submit">Create Account</button>
        </form>
      </div>
      <p style={{ marginTop: 16 }}>Already have an account? <a onClick={() => navigate("login")}>Login here</a>.</p>
    </div>
  );
}

/* ======================================================================
   HR DASHBOARD
   ====================================================================== */

function HRDashboard() {
  const [tab, setTab] = useState("jobs");
  return (
    <div className="container page-section">
      <h1 style={{ fontSize: "1.9rem" }}>HR Dashboard</h1>
      <div className="tabs">
        <button className={tab === "jobs" ? "tab active" : "tab"} onClick={() => setTab("jobs")}>Job Positions</button>
        <button className={tab === "applicants" ? "tab active" : "tab"} onClick={() => setTab("applicants")}>Applicants</button>
        <button className={tab === "shortlist" ? "tab active" : "tab"} onClick={() => setTab("shortlist")}>Candidates</button>
        <button className={tab === "interviews" ? "tab active" : "tab"} onClick={() => setTab("interviews")}>Interviews</button>
      </div>
      {tab === "jobs" && <JobsTab />}
      {tab === "applicants" && <ApplicantsTab />}
      {tab === "shortlist" && <CandidatesTab />}
      {tab === "interviews" && <InterviewsTab />}
    </div>
  );
}

/* Shared read-only profile view used both for an Applicant (raw CV
   submission) and a Candidate (an applicant HR has shortlisted). Takes
   a record with the same shape either way, plus a list of action
   buttons specific to where it's being shown from. */
function CVFileActions({ record, preview = false }) {
  const [previewUrl, setPreviewUrl] = useState(record.resumeFileData || "");
  useEffect(() => {
    let objectUrl = "";
    if (!record.resumeFileData && record.resumeFileId) {
      getCVFile(record.resumeFileId).then((blob) => { if (blob) { objectUrl = URL.createObjectURL(blob); setPreviewUrl(objectUrl); } }).catch(console.error);
    }
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [record.resumeFileId, record.resumeFileData]);
  if (!record.resumeFileData && !record.resumeFileId) return <p className="muted-small">No CV file on record.</p>;
  return <>
    <button type="button" className="btn btn-outline btn-sm" onClick={() => viewCV(record)}>View CV</button>{" "}<button type="button" className="btn btn-outline btn-sm" onClick={() => downloadCV(record)}>⬇ Download</button>
    {preview && previewUrl && <iframe title="CV preview" src={previewUrl} className="cv-preview-frame" />}
  </>;
}

function ProfileDetail({ record, jobTitle, onClose, actions }) {
  const isPdf =
    record.resumeFileType &&
    record.resumeFileType.includes("pdf");

  const currentStatus = record.status || "Applied";

  return (
    <div className="card detail-panel">

      {/* CLOSE BUTTON */}
      <button
        className="btn btn-outline btn-sm close-btn"
        onClick={onClose}
      >
        Close
      </button>

      {/* CANDIDATE NAME */}
      <h3>{record.name}</h3>

      {/* JOB AND APPLIED DATE */}
      <p className="muted-small">
        {jobTitle || "Unknown"} · Applied{" "}
        {record.appliedAt
          ? new Date(record.appliedAt).toLocaleDateString()
          : "N/A"}
      </p>

      {/* CANDIDATE INFORMATION */}
      <div
        className="profile-meta"
        style={{
          marginTop: "18px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px"
        }}
      >
        <div>
          <strong>Email:</strong>
          <br />
          {record.email || "N/A"}
        </div>

        <div>
          <strong>Phone:</strong>
          <br />
          {record.phone || "N/A"}
        </div>

        <div>
          <strong>Applied Job:</strong>
          <br />
          {jobTitle || "Unknown"}
        </div>

        <div>
          <strong>Application Date:</strong>
          <br />
          {record.appliedAt
            ? new Date(record.appliedAt).toLocaleDateString()
            : "N/A"}
        </div>
      </div>

      {/* CURRENT STATUS AND PIPELINE */}
      <div
        style={{
          marginTop: "22px",
          padding: "16px 18px",
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: "10px"
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap"
          }}
        >
          <strong>Current Status:</strong>

          <span
            style={{
              display: "inline-block",
              padding: "6px 12px",
              borderRadius: "20px",
              fontWeight: "600",
              fontSize: "14px",

              background:
                currentStatus === "Rejected"
                  ? "#fee2e2"
                  : currentStatus === "Hired"
                  ? "#dcfce7"
                  : "#e0e7ff",

              color:
                currentStatus === "Rejected"
                  ? "#b91c1c"
                  : currentStatus === "Hired"
                  ? "#166534"
                  : "#3730a3"
            }}
          >
            {currentStatus}
          </span>
        </div>

        {/* PIPELINE */}
        <div
          style={{
            marginTop: "16px"
          }}
        >
          <strong>Pipeline:</strong>

          <div
            style={{
              marginTop: "10px"
            }}
          >
            <PipelineRail
              currentIndex={stageIndex(currentStatus)}
              rejected={currentStatus === "Rejected"}
            />
          </div>
        </div>
      </div>

      {/* COVER NOTE */}
      {record.coverNote && (
        <div
          style={{
            marginTop: "20px"
          }}
        >
          <strong>Cover Note:</strong>

          <p
            style={{
              marginTop: "6px",
              lineHeight: "1.6"
            }}
          >
            {record.coverNote}
          </p>
        </div>
      )}

      {/* AI MATCH SCORE */}
      <div
        style={{
          marginTop: "20px"
        }}
      >
        <strong>AI Match Score:</strong>{" "}

        <span className="match-score">
          {record.matchScore || 0}%
        </span>

        <span className="muted-small">
          {" "}visible to staff only
        </span>
      </div>

      {/* KEYWORDS */}
      <div
        style={{
          marginTop: "10px"
        }}
      >
        {(record.matchedKeywords || []).map((keyword) => (
          <span
            className="keyword-chip hit"
            key={keyword}
          >
            {keyword}
          </span>
        ))}

        {(record.missingKeywords || []).map((keyword) => (
          <span
            className="keyword-chip miss"
            key={keyword}
          >
            {keyword}
          </span>
        ))}
      </div>

      {/* SUBMITTED CV */}
      <h4
        style={{
          marginTop: "22px"
        }}
      >
        Submitted CV
      </h4>

      <CVFileActions
        record={record}
        preview={isPdf}
      />

      {/* EXTRACTED CV TEXT */}
      <details
        style={{
          marginTop: "12px"
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            fontWeight: "600"
          }}
        >
          View extracted CV text
        </summary>

        <pre className="resume-preview">
          {record.resumeText ||
            "No extracted CV text available."}
        </pre>
      </details>

      {/* EXISTING ACTION BUTTONS */}
      {actions && (
        <div
          className="decision-buttons"
          style={{
            marginTop: "22px"
          }}
        >
          {actions}
        </div>
      )}

    </div>
  );
}
function JobsTab() {
  const [jobs, setJobs] = useState(load(KEYS.jobs));

  const [form, setForm] = useState({
    title: "",
    department: "",
    description: "",
    requirements: ""
  });

  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editingJobId, setEditingJobId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");

  // DELETE MODAL
  const [jobToDelete, setJobToDelete] = useState(null);

  function refresh() {
    setJobs(load(KEYS.jobs));
  }

  function showSuccess(message) {
    setSuccessMessage(message);

    setTimeout(() => {
      setSuccessMessage("");
    }, 3000);
  }

  // CREATE OR UPDATE JOB
  function handleSubmit(e) {
    e.preventDefault();

    setError("");
    setSuccessMessage("");

    if (!form.title || !form.description || !form.requirements) {
      setError("Title, description and requirements are required.");
      return;
    }

    const all = load(KEYS.jobs);

    // UPDATE JOB
    if (editingJobId) {
      const updatedJobs = all.map((job) =>
        job.id === editingJobId
          ? {
              ...job,
              title: form.title,
              department: form.department,
              description: form.description,
              requirements: form.requirements
            }
          : job
      );

      save(KEYS.jobs, updatedJobs);

      setEditingJobId(null);

      showSuccess("Job details updated successfully.");
    }

    // CREATE JOB
    else {
      all.unshift({
        id: uid("job"),
        ...form,
        status: "open",
        createdAt: new Date().toISOString()
      });

      save(KEYS.jobs, all);

      showSuccess("Job created successfully.");
    }

    setForm({
      title: "",
      department: "",
      description: "",
      requirements: ""
    });

    refresh();
  }

  // EDIT JOB
  function editJob(job) {
    setEditingJobId(job.id);

    setError("");
    setSuccessMessage("");

    setForm({
      title: job.title,
      department: job.department || "",
      description: job.description,
      requirements: job.requirements
    });

    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }

  // CANCEL EDIT
  function cancelEdit() {
    setEditingJobId(null);

    setForm({
      title: "",
      department: "",
      description: "",
      requirements: ""
    });

    setError("");
  }

  // CLOSE / REOPEN JOB
  function toggleStatus(job) {
    const all = load(KEYS.jobs).map((j) =>
      j.id === job.id
        ? {
            ...j,
            status: j.status === "open" ? "closed" : "open"
          }
        : j
    );

    save(KEYS.jobs, all);

    refresh();

    if (job.status === "open") {
      showSuccess("Job closed successfully.");
    } else {
      showSuccess("Job reopened successfully.");
    }
  }

  // OPEN DELETE CONFIRMATION
  function openDeleteModal(job) {
    setJobToDelete(job);
  }

  // CANCEL DELETE
  function cancelDelete() {
    setJobToDelete(null);
  }

  // CONFIRM DELETE
  function confirmDelete() {
    if (!jobToDelete) {
      return;
    }

    const all = load(KEYS.jobs);

    const updatedJobs = all.filter(
      (job) => job.id !== jobToDelete.id
    );

    save(KEYS.jobs, updatedJobs);

    // If deleted job was being edited
    if (editingJobId === jobToDelete.id) {
      setEditingJobId(null);

      setForm({
        title: "",
        department: "",
        description: "",
        requirements: ""
      });
    }

    setJobToDelete(null);

    refresh();

    showSuccess("Job deleted successfully.");
  }

  // SEARCH JOB
  const filteredJobs = jobs.filter((job) => {
    const search = searchTerm.toLowerCase().trim();

    return (
      job.title.toLowerCase().includes(search) ||
      (job.department || "").toLowerCase().includes(search)
    );
  });

  return (
    <div>

      {/* =========================
          DELETE CONFIRMATION MODAL
      ========================== */}

      {jobToDelete && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0, 0, 0, 0.45)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 9999
          }}
        >
          <div
            style={{
              width: "420px",
              maxWidth: "90%",
              background: "#ffffff",
              borderRadius: "14px",
              padding: "28px",
              boxShadow: "0 15px 40px rgba(0,0,0,0.25)"
            }}
          >
            {/* ICON */}
            <div
              style={{
                width: "55px",
                height: "55px",
                borderRadius: "50%",
                background: "#fee2e2",
                color: "#dc2626",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                fontSize: "27px",
                fontWeight: "bold",
                margin: "0 auto 18px"
              }}
            >
              !
            </div>

            {/* TITLE */}
            <h2
              style={{
                textAlign: "center",
                marginBottom: "10px",
                fontSize: "22px"
              }}
            >
              Delete Job Vacancy
            </h2>

            {/* MESSAGE */}
            <p
              style={{
                textAlign: "center",
                color: "#6b7280",
                lineHeight: "1.6",
                marginBottom: "25px"
              }}
            >
              Are you sure you want to delete{" "}
              <strong style={{ color: "#111827" }}>
                "{jobToDelete.title}"
              </strong>
              ?
              <br />
              This action cannot be undone.
            </p>

            {/* BUTTONS */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "12px"
              }}
            >
              <button
                type="button"
                onClick={cancelDelete}
                style={{
                  padding: "10px 22px",
                  borderRadius: "8px",
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  color: "#374151",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmDelete}
                style={{
                  padding: "10px 22px",
                  borderRadius: "8px",
                  border: "none",
                  background: "#dc2626",
                  color: "#ffffff",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================
          SUCCESS MESSAGE
      ========================== */}

      {successMessage && (
        <div
          style={{
            background: "#ecfdf3",
            border: "1px solid #86efac",
            color: "#166534",
            padding: "14px 18px",
            borderRadius: "10px",
            marginBottom: "18px",
            fontWeight: "600",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
          }}
        >
          <span>
            ✓ {successMessage}
          </span>

          <button
            type="button"
            onClick={() => setSuccessMessage("")}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "20px",
              color: "#166534",
              fontWeight: "bold"
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* =========================
          CREATE / EDIT JOB FORM
      ========================== */}

      <div
        className="card"
        style={{ marginBottom: 24 }}
      >
        <h3>
          {editingJobId
            ? "Update Job Vacancy"
            : "Create a new job position"}
        </h3>

        <form
          className="form"
          onSubmit={handleSubmit}
        >
          <div className="form-row">

            <label>
              Title *

              <input
                required
                value={form.title}
                onChange={(e) =>
                  setForm({
                    ...form,
                    title: e.target.value
                  })
                }
              />
            </label>

            <label>
              Department

              <input
                value={form.department}
                onChange={(e) =>
                  setForm({
                    ...form,
                    department: e.target.value
                  })
                }
              />
            </label>

          </div>

          <label>
            Description *

            <textarea
              required
              rows="3"
              value={form.description}
              onChange={(e) =>
                setForm({
                  ...form,
                  description: e.target.value
                })
              }
            />
          </label>

          <label>
            Requirements *

            <span className="hint">
              List required skills/experience.
            </span>

            <textarea
              required
              rows="3"
              value={form.requirements}
              onChange={(e) =>
                setForm({
                  ...form,
                  requirements: e.target.value
                })
              }
            />
          </label>

          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                padding: "12px 16px",
                borderRadius: "8px",
                marginBottom: "12px"
              }}
            >
              {error}
            </div>
          )}

          <button
            className="btn btn-primary"
            type="submit"
          >
            {editingJobId
              ? "Update Job"
              : "Create Job"}
          </button>

          {editingJobId && (
            <button
              className="btn btn-outline"
              type="button"
              onClick={cancelEdit}
              style={{
                marginLeft: "10px"
              }}
            >
              Cancel
            </button>
          )}

        </form>
      </div>

      {/* =========================
          JOB LIST HEADER
      ========================== */}

      <div
        className="section-head"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "15px",
          flexWrap: "wrap"
        }}
      >
        <h2
          style={{
            fontSize: "1.3rem"
          }}
        >
          All Job Positions
        </h2>

        <input
          type="text"
          placeholder="Search by job title or department..."
          value={searchTerm}
          onChange={(e) =>
            setSearchTerm(e.target.value)
          }
          style={{
            width: "320px",
            maxWidth: "100%",
            padding: "11px 14px",
            border: "1px solid #d1d5db",
            borderRadius: "8px",
            fontSize: "14px",
            outline: "none"
          }}
        />
      </div>

      {/* =========================
          JOB TABLE
      ========================== */}

      <div className="table-wrap">

        <table className="data-table">

          <thead>
            <tr>
              <th>Title</th>
              <th>Department</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>

            {filteredJobs.length > 0 ? (

              filteredJobs.map((j) => (

                <tr key={j.id}>

                  <td>
                    {j.title}
                  </td>

                  <td>
                    {j.department}
                  </td>

                  <td>
                    <span
                      className={`badge ${
                        j.status === "open"
                          ? "badge-open"
                          : "badge-closed"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>

                  <td>
                    {new Date(
                      j.createdAt
                    ).toLocaleDateString()}
                  </td>

                  <td
                    style={{
                      whiteSpace: "nowrap"
                    }}
                  >

                    {/* EDIT */}
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => editJob(j)}
                    >
                      Edit
                    </button>

                    {" "}

                    {/* CLOSE / REOPEN */}
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => toggleStatus(j)}
                    >
                      {j.status === "open"
                        ? "Close"
                        : "Reopen"}
                    </button>

                    {" "}

                    {/* DELETE */}
                    <button
                      className="btn btn-outline btn-sm"
                      type="button"
                      onClick={() => openDeleteModal(j)}
                      style={{
                        color: "#b91c1c",
                        borderColor: "#fecaca"
                      }}
                    >
                      Delete
                    </button>

                  </td>

                </tr>

              ))

            ) : (

              <tr>
                <td
                  colSpan="5"
                  style={{
                    textAlign: "center",
                    padding: "25px"
                  }}
                >
                  No job vacancies found.
                </td>
              </tr>

            )}

          </tbody>

        </table>

      </div>

    </div>
  );
}
function ApplicantsTab() {
  const jobs = load(KEYS.jobs);
  const [jobFilter, setJobFilter] = useState("");
  // New AI CV-to-CV comparison filter. The selected job determines
  // which candidate CVs are compared with one another.
  const [cvCompareJob, setCvCompareJob] = useState("");
  const [applicants, setApplicants] = useState(load(KEYS.applicants));
  const [scheduling, setScheduling] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ interviewer_id: "", scheduled_at: "", notes: "" });
  const [profileId, setProfileId] = useState(null);
  const interviewers = load(KEYS.users).filter((u) => u.role === "interviewer");

  function refresh() { setApplicants(load(KEYS.applicants)); }
  const peerCVScores = cvCompareJob ? calculatePeerCVScores(applicants, cvCompareJob) : {};
  const visible = applicants
    .filter((a) => (!jobFilter || a.jobId === jobFilter) && (!cvCompareJob || a.jobId === cvCompareJob))
    .sort((a, b) => cvCompareJob
      ? (peerCVScores[b.id] || 0) - (peerCVScores[a.id] || 0)
      : b.matchScore - a.matchScore);
  function jobTitle(id) { const j = jobs.find((x) => x.id === id); return j ? j.title : "Unknown"; }

  function updateStatus(applicantId, status) {
    const all = load(KEYS.applicants).map((a) => a.id === applicantId ? { ...a, status } : a);
    save(KEYS.applicants, all);
    refresh();
  }

  function submitSchedule(applicantId) {
    if (!scheduleForm.interviewer_id || !scheduleForm.scheduled_at) return;
    const interviews = load(KEYS.interviews);
    interviews.push({ id: uid("iv"), candidateId: applicantId, interviewerId: scheduleForm.interviewer_id, scheduledAt: scheduleForm.scheduled_at, status: "Scheduled", notes: scheduleForm.notes, createdAt: new Date().toISOString() });
    save(KEYS.interviews, interviews);
    updateStatus(applicantId, "Interview Scheduled");
    setScheduling(null);
    setScheduleForm({ interviewer_id: "", scheduled_at: "", notes: "" });
  }

  function isAlreadyCandidate(applicantId) {
    return load(KEYS.candidates).some((c) => c.applicantId === applicantId);
  }

  function addToCandidates(applicant) {
    try {
      if (isAlreadyCandidate(applicant.id)) return;
      const shortlist = load(KEYS.candidates);
      shortlist.push({
        id: uid("cand"), applicantId: applicant.id, jobId: applicant.jobId,
        name: applicant.name, email: applicant.email, phone: applicant.phone,
        coverNote: applicant.coverNote, resumeText: applicant.resumeText,
        resumeFileName: applicant.resumeFileName, resumeFileType: applicant.resumeFileType, resumeFileId: applicant.resumeFileId, resumeFileData: applicant.resumeFileData,
        matchScore: applicant.matchScore, matchedKeywords: applicant.matchedKeywords, missingKeywords: applicant.missingKeywords,
        appliedAt: applicant.appliedAt, pinned: false, addedAt: new Date().toISOString(),
      });
      save(KEYS.candidates, shortlist);
      window.dispatchEvent(new Event("hl-candidates-updated"));
      refresh();
    } catch (e) {
      console.error("Failed to add applicant to candidates:", e);
      alert("Could not add this applicant to Candidates. Please try again.");
    }
  }

  const profileApplicant = profileId ? applicants.find((a) => a.id === profileId) : null;

  return (
    <div>
      <label className="inline-filter">Filter by job:
        <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
          <option value="">All jobs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </label>

      <label className="inline-filter">CV-to-CV:
        <select value={cvCompareJob} onChange={(e) => setCvCompareJob(e.target.value)}>
          <option value="">Select a job to compare CVs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </label>
      {cvCompareJob && (
        <p className="muted-small" style={{ marginBottom: 12 }}>
          CVs are compared with the other applicants for the selected job and ranked by average CV similarity.
        </p>
      )}

      {interviewers.length === 0 && <p className="muted-small" style={{ marginBottom: 12 }}>Tip: register an Interviewer account first so you can assign interviews below.</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Job</th><th>AI Match</th>{cvCompareJob && <th>CV Similarity</th>}<th>Pipeline</th><th>Status</th><th>CV</th><th>Actions</th></tr></thead>
          <tbody>
            {visible.map((a) => (
              <React.Fragment key={a.id}>
                <tr>
                  <td>{a.name}<div className="muted-small">{a.email}</div></td>
                  <td>{jobTitle(a.jobId)}</td>
                  <td><span className="match-score">{a.matchScore}%</span></td>
                  {cvCompareJob && <td><span className="match-score">{peerCVScores[a.id] || 0}%</span></td>}
                  <td><PipelineRail currentIndex={stageIndex(a.status)} rejected={a.status === "Rejected"} mini /></td>
                  <td>
                    <select value={a.status} onChange={(e) => updateStatus(a.id, e.target.value)}>
                      {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>{(a.resumeFileData || a.resumeFileId) ? <><button className="btn btn-outline btn-sm" onClick={() => viewCV(a)}>View CV</button>{" "}<button className="btn btn-outline btn-sm" onClick={() => downloadCV(a)}>Download</button></> : <span className="muted-small"></span>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn btn-outline btn-sm" onClick={() => setProfileId(a.id)}>View</button>{" "}
                    <button className="btn btn-outline btn-sm" onClick={() => setScheduling(scheduling === a.id ? null : a.id)}>{scheduling === a.id ? "Cancel" : "Schedule"}</button>
                  </td>
                </tr>
                {scheduling === a.id && (
                  <tr><td colSpan={cvCompareJob ? "8" : "7"}>
                    <div className="inline-schedule">
                      <select value={scheduleForm.interviewer_id} onChange={(e) => setScheduleForm({ ...scheduleForm, interviewer_id: e.target.value })}>
                        <option value="">Select interviewer</option>
                        {interviewers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                      <input type="datetime-local" value={scheduleForm.scheduled_at} onChange={(e) => setScheduleForm({ ...scheduleForm, scheduled_at: e.target.value })} />
                      <input placeholder="Notes (optional)" value={scheduleForm.notes} onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })} />
                      <button className="btn btn-primary btn-sm" onClick={() => submitSchedule(a.id)}>Confirm</button>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="empty-state">No applicants found.</p>}

      {profileApplicant && (
        <ProfileDetail
          record={profileApplicant}
          jobTitle={jobTitle(profileApplicant.jobId)}
          onClose={() => setProfileId(null)}
          actions={
            isAlreadyCandidate(profileApplicant.id) ? (
              <button className="btn btn-primary btn-sm" disabled>Added</button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => addToCandidates(profileApplicant)}>Add to Candidates</button>
            )
          }
        />
      )}
    </div>
  );
}

function CandidatesTab() {
  const jobs = load(KEYS.jobs);
  const [jobFilter, setJobFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score_desc");
  const [candidates, setCandidates] = useState(load(KEYS.candidates));
  const [profileId, setProfileId] = useState(null);

  useEffect(() => {
    const sync = () => setCandidates(load(KEYS.candidates));
    window.addEventListener("hl-candidates-updated", sync);
    return () => window.removeEventListener("hl-candidates-updated", sync);
  }, []);

  function refresh() { setCandidates(load(KEYS.candidates)); }
  function jobTitle(id) { const j = jobs.find((x) => x.id === id); return j ? j.title : "Unknown"; }

  let visible = candidates.filter((c) => !jobFilter || c.jobId === jobFilter);
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    visible = visible.filter((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
  }
  visible = visible.sort((a, b) => {
    if (sortBy === "score_desc") return b.matchScore - a.matchScore;
    if (sortBy === "score_asc") return a.matchScore - b.matchScore;
    if (sortBy === "name") return a.name.localeCompare(b.name);
    return 0;
  });
  // Pinned candidates always float to the top, regardless of sort order.
  visible = [...visible.filter((c) => c.pinned), ...visible.filter((c) => !c.pinned)];

  function togglePin(id) {
    const all = load(KEYS.candidates).map((c) => c.id === id ? { ...c, pinned: !c.pinned } : c);
    save(KEYS.candidates, all);
    refresh();
  }

  function deleteCandidate(id) {
    if (!window.confirm("Remove this person from Candidates? They will remain on record in Applicants.")) return;
    const all = load(KEYS.candidates).filter((c) => c.id !== id);
    save(KEYS.candidates, all);
    setProfileId(null);
    refresh();
  }

  const profileCandidate = profileId ? candidates.find((c) => c.id === profileId) : null;

  return (
    <div>
      <div className="search-sort-bar">
        <input
          className="search-input"
          placeholder="Search candidates by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="inline-filter">Job:
          <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
            <option value="">All jobs</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </label>
        <label className="inline-filter">Sort:
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="score_desc">AI Match: High → Low</option>
            <option value="score_asc">AI Match: Low → High</option>
            <option value="name">Name (A–Z)</option>
          </select>
        </label>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th></th><th>Name</th><th>Job</th><th>AI Match</th><th>Added</th><th>Actions</th></tr></thead>
          <tbody>
            {visible.map((c) => (
              <tr key={c.id}>
                <td>
                  <button className={"pin-btn" + (c.pinned ? " pinned" : "")} title={c.pinned ? "Unpin" : "Pin to top"} onClick={() => togglePin(c.id)}>
                    <Icon.Pin />
                  </button>
                </td>
                <td>{c.name}<div className="muted-small">{c.email}</div></td>
                <td>{jobTitle(c.jobId)}</td>
                <td><span className="match-score">{c.matchScore}%</span></td>
                <td>{new Date(c.addedAt).toLocaleDateString()}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <button className="btn btn-outline btn-sm" onClick={() => setProfileId(c.id)}>View</button>{" "}
                  <button className="btn btn-outline btn-sm" onClick={() => deleteCandidate(c.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="empty-state">No candidates yet  add strong applicants to this shortlist from the Applicants tab.</p>}

      {profileCandidate && (
        <ProfileDetail
          record={profileCandidate}
          jobTitle={jobTitle(profileCandidate.jobId)}
          onClose={() => setProfileId(null)}
          actions={
            <>
              <button className={"btn btn-sm " + (profileCandidate.pinned ? "btn-primary" : "btn-outline")} onClick={() => togglePin(profileCandidate.id)}>
                {profileCandidate.pinned ? "Unpin" : "Pin candidate"}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => deleteCandidate(profileCandidate.id)}>Delete candidate</button>
            </>
          }
        />
      )}
    </div>
  );
}

function InterviewsTab() {
  const interviews = load(KEYS.interviews);
  const candidates = load(KEYS.applicants);
  const jobs = load(KEYS.jobs);
  const users = load(KEYS.users);
  const feedback = load(KEYS.feedback);

  function candidate(id) { return candidates.find((c) => c.id === id); }
  function jobTitle(candidateId) { const c = candidate(candidateId); const j = jobs.find((x) => x.id === (c && c.jobId)); return j ? j.title : "-"; }
  function interviewerName(id) { const u = users.find((x) => x.id === id); return u ? u.name : "-"; }
  function feedbackFor(interviewId) { return feedback.find((f) => f.interviewId === interviewId); }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Candidate</th><th>Job</th><th>Interviewer</th><th>Scheduled</th><th>Status</th><th>Feedback</th></tr></thead>
        <tbody>
          {interviews.map((i) => {
            const c = candidate(i.candidateId);
            const f = feedbackFor(i.id);
            return (
              <tr key={i.id}>
                <td>{c ? c.name : "-"}</td>
                <td>{jobTitle(i.candidateId)}</td>
                <td>{interviewerName(i.interviewerId)}</td>
                <td>{new Date(i.scheduledAt).toLocaleString()}</td>
                <td><span className="badge">{i.status}</span></td>
                <td>{f ? `${f.rating}/5  ${f.recommendation}` : "Pending"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {interviews.length === 0 && <p className="empty-state">No interviews scheduled yet.</p>}
    </div>
  );
}

/* ======================================================================
   INTERVIEWER DASHBOARD
   ====================================================================== */

function InterviewerDashboard({ user }) {
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ rating: 5, comments: "", recommendation: "Hire" });
  const [, forceRender] = useState(0);

  const interviews = load(KEYS.interviews).filter((i) => i.interviewerId === user.id);
  const candidates = load(KEYS.applicants);
  const jobs = load(KEYS.jobs);
  const feedbackAll = load(KEYS.feedback);

  function candidate(id) { return candidates.find((c) => c.id === id); }
  function job(jobId) { return jobs.find((j) => j.id === jobId); }
  function feedbackFor(interviewId) { return feedbackAll.find((f) => f.interviewId === interviewId); }

  function openFeedback(iv) {
    const existing = feedbackFor(iv.id);
    setOpenId(iv.id);
    setForm(existing ? { rating: existing.rating, comments: existing.comments, recommendation: existing.recommendation } : { rating: 5, comments: "", recommendation: "Hire" });
  }

  function submitFeedback(iv) {
    const all = load(KEYS.feedback);
    const idx = all.findIndex((f) => f.interviewId === iv.id);
    const entry = { id: idx >= 0 ? all[idx].id : uid("fb"), interviewId: iv.id, interviewerId: user.id, ...form, createdAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    save(KEYS.feedback, all);
    save(KEYS.interviews, load(KEYS.interviews).map((i) => i.id === iv.id ? { ...i, status: "Completed" } : i));
    save(KEYS.applicants, load(KEYS.applicants).map((c) => c.id === iv.candidateId ? { ...c, status: "Interviewed" } : c));
    setOpenId(null);
    forceRender((n) => n + 1);
  }

  return (
    <div className="container page-section">
      <h1 style={{ fontSize: "1.9rem" }}>Interviewer Dashboard</h1>
      <p>Your assigned interviews are listed below. Submit your feedback after each interview.</p>

      {interviews.map((iv) => {
        const c = candidate(iv.candidateId);
        const j = c ? job(c.jobId) : null;
        const fb = feedbackFor(iv.id);
        return (
          <div className="card" key={iv.id} style={{ marginBottom: 18 }}>
            <div className="interview-header">
              <div>
                <h3 style={{ fontSize: "1.1rem" }}>{c ? c.name : "Unknown"}  {j ? j.title : ""}</h3>
                <p className="muted-small">Scheduled: {new Date(iv.scheduledAt).toLocaleString()} · Status: {iv.status}</p>
                <p className="muted-small">AI Match Score: {c ? c.matchScore : "-"}%</p>
                {c && (c.resumeFileData || c.resumeFileId) && <a className="cv-link" onClick={() => downloadCV(c)}>⬇ Download CV ({c.resumeFileName})</a>}
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => openFeedback(iv)}>{fb ? "Edit Feedback" : "Give Feedback"}</button>
            </div>

            <details>
              <summary>View extracted CV text</summary>
              <pre className="resume-preview">{c ? c.resumeText : ""}</pre>
            </details>

            {openId === iv.id && (
              <div className="feedback-form">
                <label>Rating (1-5)<input type="number" min="1" max="5" value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} /></label>
                <label>Recommendation
                  <select value={form.recommendation} onChange={(e) => setForm({ ...form, recommendation: e.target.value })}>
                    <option value="Hire">Hire</option><option value="Maybe">Maybe</option><option value="No Hire">No Hire</option>
                  </select>
                </label>
                <label>Comments<textarea rows="3" value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} /></label>
                <button className="btn btn-primary btn-sm" onClick={() => submitFeedback(iv)}>Submit Feedback</button>
              </div>
            )}
          </div>
        );
      })}
      {interviews.length === 0 && <p className="empty-state">You have no interviews assigned yet.</p>}
    </div>
  );
}

/* ======================================================================
   MANAGER DASHBOARD
   ====================================================================== */

function ManagerDashboard({ user }) {
  const [tab, setTab] = useState("candidates");
  return (
    <div className="container page-section">
      <h1 style={{ fontSize: "1.9rem" }}>Hiring Manager Dashboard</h1>
      <div className="tabs">
        <button className={tab === "candidates" ? "tab active" : "tab"} onClick={() => setTab("candidates")}>Review Candidates</button>
        <button className={tab === "decisions" ? "tab active" : "tab"} onClick={() => setTab("decisions")}>Decision Log</button>
        <button className={tab === "reports" ? "tab active" : "tab"} onClick={() => setTab("reports")}>Reporting Dashboard</button>
      </div>
      {tab === "candidates" && <ReviewCandidates user={user} />}
      {tab === "decisions" && <DecisionLog />}
      {tab === "reports" && <Reports />}
    </div>
  );
}

function ReviewCandidates({ user }) {
  const jobs = load(KEYS.jobs);
  const users = load(KEYS.users);
  const [jobFilter, setJobFilter] = useState("");
  const [, forceRender] = useState(0);
  const [detailId, setDetailId] = useState(null);
  const [decisionNotes, setDecisionNotes] = useState("");

  const candidates = load(KEYS.applicants).filter((c) => !jobFilter || c.jobId === jobFilter).sort((a, b) => b.matchScore - a.matchScore);
  function jobFor(id) { return jobs.find((j) => j.id === id); }
  const detail = detailId ? load(KEYS.applicants).find((c) => c.id === detailId) : null;
  const interviewsForDetail = detail ? load(KEYS.interviews).filter((i) => i.candidateId === detail.id) : [];
  const feedbackAll = load(KEYS.feedback);
  function feedbackFor(interviewId) { return feedbackAll.find((f) => f.interviewId === interviewId); }
  function interviewerName(id) { const u = users.find((x) => x.id === id); return u ? u.name : "-"; }

  function avgRating() {
    const rated = interviewsForDetail.map((i) => feedbackFor(i.id)).filter(Boolean);
    if (rated.length === 0) return "N/A";
    return (rated.reduce((sum, f) => sum + f.rating, 0) / rated.length).toFixed(1);
  }

  function makeDecision(decision) {
    const decisions = load(KEYS.decisions);
    decisions.push({ id: uid("dec"), candidateId: detail.id, decision, notes: decisionNotes, decidedBy: user.id, decidedAt: new Date().toISOString() });
    save(KEYS.decisions, decisions);
    save(KEYS.applicants, load(KEYS.applicants).map((c) => c.id === detail.id ? { ...c, status: decision === "Hired" ? "Hired" : "Rejected" } : c));
    setDetailId(null);
    setDecisionNotes("");
    forceRender((n) => n + 1);
  }

  return (
    <div>
      <label className="inline-filter">Filter by job:
        <select value={jobFilter} onChange={(e) => setJobFilter(e.target.value)}>
          <option value="">All jobs</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
        </select>
      </label>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Name</th><th>Job</th><th>AI Match</th><th>Pipeline</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {candidates.map((c) => {
              const j = jobFor(c.jobId);
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{j ? j.title : "-"}</td>
                  <td className="match-score">{c.matchScore}%</td>
                  <td><PipelineRail currentIndex={stageIndex(c.status)} rejected={c.status === "Rejected"} mini /></td>
                  <td><span className="badge">{c.status}</span></td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => { setDetailId(c.id); setDecisionNotes(""); }}>Review</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {candidates.length === 0 && <p className="empty-state">No candidates found for this filter.</p>}

      {detail && (
        <div className="card detail-panel">
          <button className="btn btn-outline btn-sm close-btn" onClick={() => setDetailId(null)}>Close</button>
          <h3>{detail.name}  {(jobFor(detail.jobId) || {}).title}</h3>
          <PipelineRail currentIndex={stageIndex(detail.status)} rejected={detail.status === "Rejected"} showLabels />
          <p style={{ marginTop: 14 }}><strong>AI Match Score:</strong> {detail.matchScore}% · <strong>Avg. Interview Rating:</strong> {avgRating()}/5</p>
          {(detail.resumeFileData || detail.resumeFileId) && <p><a className="cv-link" onClick={() => downloadCV(detail)}>⬇ Download CV ({detail.resumeFileName})</a></p>}
          <div>
            {detail.matchedKeywords.map((k) => <span className="keyword-chip hit" key={k}>{k}</span>)}
            {detail.missingKeywords.map((k) => <span className="keyword-chip miss" key={k}>{k}</span>)}
          </div>

          <h4 style={{ marginTop: 18 }}>Interview Feedback</h4>
          {interviewsForDetail.length === 0 && <p className="muted-small">No interviews recorded yet.</p>}
          {interviewsForDetail.map((iv) => {
            const f = feedbackFor(iv.id);
            return (
              <div className="feedback-item" key={iv.id}>
                <p><strong>{interviewerName(iv.interviewerId)}</strong>  {new Date(iv.scheduledAt).toLocaleString()} ({iv.status})</p>
                {f ? <p>Rating: {f.rating}/5 · Recommendation: {f.recommendation}<br />{f.comments}</p> : <p className="muted-small">No feedback submitted yet.</p>}
              </div>
            );
          })}

          {detail.status !== "Hired" && detail.status !== "Rejected" && (
            <div className="decision-box">
              <h4>Make a Hiring Decision</h4>
              <textarea rows="2" placeholder="Decision notes (optional)" value={decisionNotes} onChange={(e) => setDecisionNotes(e.target.value)} />
              <div className="decision-buttons">
                <button className="btn btn-primary btn-sm" onClick={() => makeDecision("Hired")}>Hire Candidate</button>
                <button className="btn btn-outline btn-sm" onClick={() => makeDecision("Rejected")}>Reject Candidate</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionLog() {
  const decisions = load(KEYS.decisions);
  const candidates = load(KEYS.applicants);
  const jobs = load(KEYS.jobs);
  const users = load(KEYS.users);
  function candidateName(id) { const c = candidates.find((x) => x.id === id); return c ? c.name : "-"; }
  function jobTitleFor(candidateId) { const c = candidates.find((x) => x.id === candidateId); const j = jobs.find((x) => x.id === (c && c.jobId)); return j ? j.title : "-"; }
  function decidedByName(id) { const u = users.find((x) => x.id === id); return u ? u.name : "-"; }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Candidate</th><th>Job</th><th>Decision</th><th>Decided By</th><th>Date</th><th>Notes</th></tr></thead>
        <tbody>
          {decisions.map((d) => (
            <tr key={d.id}>
              <td>{candidateName(d.candidateId)}</td>
              <td>{jobTitleFor(d.candidateId)}</td>
              <td><span className={`badge ${d.decision === "Hired" ? "badge-open" : "badge-closed"}`}>{d.decision}</span></td>
              <td>{decidedByName(d.decidedBy)}</td>
              <td>{new Date(d.decidedAt).toLocaleDateString()}</td>
              <td>{d.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {decisions.length === 0 && <p className="empty-state">No hiring decisions recorded yet.</p>}
    </div>
  );
}

function Reports() {
  const jobs = load(KEYS.jobs);
  const candidates = load(KEYS.applicants);
  const interviews = load(KEYS.interviews);

  const totalJobs = jobs.length;
  const openJobs = jobs.filter((j) => j.status === "open").length;
  const hired = candidates.filter((c) => c.status === "Hired").length;
  const rejected = candidates.filter((c) => c.status === "Rejected").length;

  const byStatus = {};
  candidates.forEach((c) => { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });

  const byJob = jobs.map((j) => {
    const jc = candidates.filter((c) => c.jobId === j.id);
    const avg = jc.length ? (jc.reduce((s, c) => s + c.matchScore, 0) / jc.length).toFixed(1) : "-";
    return { title: j.title, count: jc.length, avg };
  });

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card"><div className="stat-value">{totalJobs}</div><div className="stat-label">Total Jobs</div></div>
        <div className="stat-card"><div className="stat-value">{openJobs}</div><div className="stat-label">Open Jobs</div></div>
        <div className="stat-card"><div className="stat-value">{candidates.length}</div><div className="stat-label">Total Candidates</div></div>
        <div className="stat-card"><div className="stat-value">{interviews.length}</div><div className="stat-label">Interviews Held</div></div>
        <div className="stat-card"><div className="stat-value">{hired}</div><div className="stat-label">Hired</div></div>
        <div className="stat-card"><div className="stat-value">{rejected}</div><div className="stat-label">Rejected</div></div>
      </div>

      <h3 className="section-title" style={{ marginBottom: 14 }}>Candidates by Status</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Status</th><th>Count</th></tr></thead>
          <tbody>{Object.entries(byStatus).map(([status, count]) => <tr key={status}><td>{status}</td><td>{count}</td></tr>)}</tbody>
        </table>
      </div>

      <h3 className="section-title" style={{ marginBottom: 14 }}>By Job Position</h3>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Job</th><th>Candidates</th><th>Avg. AI Match Score</th></tr></thead>
          <tbody>{byJob.map((j) => <tr key={j.title}><td>{j.title}</td><td>{j.count}</td><td>{j.avg}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/* ======================================================================
   APP ROOT (simple state-based routing  no router library needed)
   ====================================================================== */

function App() {
  seedIfNeeded();
  const [page, setPage] = useState("home");
  const [params, setParams] = useState({});
  const [user, setUser] = useState(getSession());

  function navigate(nextPage, nextParams) {
    setPage(nextPage);
    setParams(nextParams || {});
    window.scrollTo(0, 0);
  }
  function handleLogin(u) { setSession(u); setUser(u); }
  function handleLogout() { clearSession(); setUser(null); navigate("home"); }

  let body;
  if (page === "home") body = <Home navigate={navigate} />;
  else if (page === "careers") body = <Careers navigate={navigate} />;
  else if (page === "about") body = <About />;
  else if (page === "contact") body = <Contact />;
  else if (page === "jobDetails") body = <JobDetails jobId={params.jobId} navigate={navigate} />;
  else if (page === "login") body = user ? <Home navigate={navigate} /> : <Login navigate={navigate} onLogin={handleLogin} />;
  else if (page === "register") body = user ? <Home navigate={navigate} /> : <Register navigate={navigate} onLogin={handleLogin} />;
  else if (page === "hr") body = user && user.role === "hr" ? <HRDashboard user={user} /> : <Login navigate={navigate} onLogin={handleLogin} />;
  else if (page === "interviewer") body = user && user.role === "interviewer" ? <InterviewerDashboard user={user} /> : <Login navigate={navigate} onLogin={handleLogin} />;
  else if (page === "manager") body = user && user.role === "manager" ? <ManagerDashboard user={user} /> : <Login navigate={navigate} onLogin={handleLogin} />;
  else body = <Home navigate={navigate} />;

  const isStaffPage = ["hr", "interviewer", "manager", "login", "register"].includes(page);

  return (
    <React.Fragment>
      <Navbar user={user} onLogout={handleLogout} navigate={navigate} page={page} />
      {body}
      {!isStaffPage && <Footer navigate={navigate} />}
      {isStaffPage && (
        <div className="container" style={{ paddingBottom: 30 }}>
          <a onClick={() => { if (window.confirm("This erases all saved data and restores the starting sample jobs. Continue?")) resetAllData(); }} className="muted-small">Reset demo data</a>
        </div>
      )}
    </React.Fragment>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
