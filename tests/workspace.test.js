import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import supertest from "supertest";
import { analyzeATS } from "../services/atsService.js";
import { buildResumePdf } from "../services/documentService.js";
import { suggestionOutput } from "../validation/careerSchemas.js";
let mongo, mongoose, request, token, stranger, resumeId;
before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.NODE_ENV = "test"; process.env.DB_URI = mongo.getUri(); process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-pass-validation"; process.env.GOOGLE_AI_API_KEY = "";
  const [{ default: app }, db] = await Promise.all([import("../index.js"), import("mongoose")]); mongoose = db.default; request = supertest(app);
  const signup = async email => (await request.post("/api/v1/user/register").send({ name: "Test Candidate", email, password: "Password123" })).body.data.token;
  token = await signup("workspace@example.com"); stranger = await signup("other@example.com");
  resumeId = (await request.post("/api/v1/resume/createResume").auth(token, { type: "bearer" }).send({ title: "Career resume" })).body._id;
});
after(async () => { await mongoose?.disconnect(); await mongo?.stop(); });
const api = (method, path, data, auth = token) => request[method](`/api/v1/${path}`).auth(auth, { type: "bearer" }).send(data);
test("versioning, restoration, duplication and ownership", async () => {
  assert.equal((await api("put", `resume/updateResume/${resumeId}`, { summary: "Original facts", template: "technical", paperSize: "Letter" })).status, 200);
  await api("put", `resume/updateResume/${resumeId}`, { summary: "Updated facts" });
  const versions = await api("get", `resume/${resumeId}/versions`);
  assert.equal(versions.status, 200); assert.equal(versions.body.versions.length, 2);
  const versionId = versions.body.versions[0]._id;
  assert.equal((await api("get", `resume/${resumeId}/versions`, undefined, stranger)).status, 404);
  assert.equal((await api("post", `resume/${resumeId}/versions/${versionId}/restore`, {}, stranger)).status, 404);
  const restored = await api("post", `resume/${resumeId}/versions/${versionId}/restore`, {});
  assert.equal(restored.status, 200); assert.equal(restored.body.resume.summary, "Original facts");
  const copy = await api("post", `resume/${resumeId}/duplicate`, {});
  assert.equal(copy.status, 201); assert.notEqual(copy.body.resume._id, resumeId); assert.equal(copy.body.resume.isPublic, false);
});
test("public payload excludes hidden content and targeting", async () => {
  await api("put", `resume/updateResume/${resumeId}`, { summary: "Private", targetRole: "Secret", sections: [{ id: "summary", type: "summary", title: "Summary", hidden: true }] });
  await api("patch", `resume/visibility/${resumeId}`, { isPublic: true });
  const res = await request.get(`/api/v1/resume/getResumeById/${resumeId}`);
  assert.equal(res.status, 200); assert.equal(res.body.resume.summary, ""); assert.equal(res.body.resume.targetRole, undefined); assert.equal(res.body.resume.sections.length, 0);
});
test("rich text sanitization and layout validation", async () => {
  const res = await api("put", `resume/updateResume/${resumeId}`, { experience: [{ title: "Developer", workSummary: '<p onclick="alert(1)">Built an API</p><script>alert(1)</script>' }] });
  assert.equal(res.status, 200); assert.equal(res.body.updatedResume.experience[0].workSummary, "<p>Built an API</p>");
  assert.equal((await api("put", `resume/updateResume/${resumeId}`, { fontSize: 2 })).status, 400);
  assert.equal((await api("put", `resume/updateResume/${resumeId}`, { sections: [{ id: "x", type: "skills", title: "Skills" }, { id: "x", type: "summary", title: "Summary" }] })).status, 400);
});
test("jobs and applications validate ownership and track transitions", async () => {
  const job = await api("post", "career/jobs", { title: "Engineer", company: "Example", description: "Build reliable Node.js services and MongoDB applications. Required experience includes API design, testing, and collaboration." });
  assert.equal(job.status, 200); assert.equal((await api("get", `career/jobs/${job.body.job._id}`, undefined, stranger)).status, 404);
  assert.equal((await api("post", "career/applications", { company: "Example", position: "Engineer", resume: resumeId }, stranger)).status, 404);
  const app = await api("post", "career/applications", { company: "Example", position: "Engineer", resume: resumeId, status: "Applied" });
  assert.equal(app.status, 200);
  const updated = await api("put", `career/applications/${app.body.application._id}`, { company: "Example", position: "Engineer", status: "Interview" });
  assert.equal(updated.status, 200); assert.deepEqual(updated.body.application.timeline.map(e => e.status), ["Applied", "Interview"]);
  assert.equal((await api("get", `career/applications/${app.body.application._id}`, undefined, stranger)).status, 404);
});
test("AI without configuration returns an honest service error", async () => {
  const res = await api("post", "career/generate/summary", { resumeId });
  assert.equal(res.status, 503); assert.match(res.body.message, /not configured/i); assert.equal(res.body.stack, undefined);
});
test("ATS missing evidence and partial profile skills are explicit", () => {
  const resume = { summary: "Built React applications", experience: [], skills: [{ name: "React" }] };
  const result = analyzeATS(resume, { analysis: { requiredSkills: ["React", "SQL", "Java"], keywords: ["React", "SQL"] } }, { skills: [{ name: "SQL" }] });
  assert.equal(result.skillsMatch, 33); assert.equal(result.achievementStrength, null); assert.deepEqual(result.matches.map(m => m.status), ["MATCHED", "PARTIAL", "MISSING"]);
  assert.equal(analyzeATS(resume, { analysis: {} }).keywordMatch, null);
  assert.equal(analyzeATS({ summary: "JavaScript" }, { analysis: { requiredSkills: ["Java"] } }).skillsMatch, 0);
  assert.equal(suggestionOutput.safeParse({ suggestions: [{ field: "userEmail", current: "", suggested: "", confidence: 2, reason: "", evidence: [] }], questions: [] }).success, false);
});
test("six PDF templates paginate long content on A4 and Letter", async () => {
  for (const template of ["ats-minimal", "professional", "modern", "executive", "technical", "academic"]) for (const paperSize of ["A4", "Letter"]) {
    const result = await buildResumePdf({ firstName: "Test", lastName: "Candidate", email: "test@example.com", template, paperSize, experience: Array.from({ length: 20 }, (_, i) => ({ title: `Role ${i}`, companyName: "Example", workSummary: "Built reliable services with documented requirements. ".repeat(10) })) });
    assert.equal(result.buffer.subarray(0, 5).toString(), "%PDF-"); assert.ok(result.pages >= 3); assert.ok(result.warnings.length);
  }
});
test("PDF endpoints reject private visitors", async () => {
  await api("patch", `resume/visibility/${resumeId}`, { isPublic: false });
  assert.equal((await request.get(`/api/v1/resume/${resumeId}/pdf`)).status, 404);
  const res = await api("get", `resume/${resumeId}/pdf`); assert.equal(res.status, 200); assert.match(res.headers["content-type"], /application\/pdf/);
});
test("expanded profile sections import and round-trip through explicit sync", async () => {
  await api("put", "career-profile", { projects: [{ name: "Portfolio", description: "Built a portfolio site", technologies: ["React"] }] });
  const imported = await api("post", `career-profile/import-to-resume/${resumeId}`, { sections: ["projects"] });
  assert.equal(imported.status, 200); assert.deepEqual(imported.body.applied, ["projects"]);
  const resume = (await api("get", `resume/getResumeById/${resumeId}`)).body.resume;
  assert.ok(resume.sections.some(s => s.type === "projects" && s.content.includes("Portfolio")));
  assert.equal((await api("post", `career-profile/sync-from-resume/${resumeId}`, {})).status, 200);
  const profile = (await api("get", "career-profile")).body.profile;
  assert.ok(profile.sections.some(s => s.type === "projects"));
});
test("suggestion approval is ownership checked and rejects stale content", async () => {
  const { AIAnalysis } = await import("../Models/CareerWorkspace.Model.js");
  await api("put", `resume/updateResume/${resumeId}`, { summary: "Built reliable services" });
  const suggestion = await AIAnalysis.create({ userEmail: "workspace@example.com", resume: resumeId, kind: "summary", output: { suggestions: [{ field: "summary", current: "Built reliable services", suggested: "Developed reliable services", confidence: 0.9, reason: "Clear action", evidence: ["Built reliable services"] }], questions: [] } });
  assert.equal((await api("post", `career/analyses/${suggestion._id}/apply`, { index: 0, confirmed: true }, stranger)).status, 404);
  assert.equal((await api("post", `career/analyses/${suggestion._id}/apply`, { index: 0 })).status, 400);
  assert.equal((await api("post", `career/analyses/${suggestion._id}/apply`, { index: 0, confirmed: true })).status, 200);
  assert.equal((await api("post", `career/analyses/${suggestion._id}/apply`, { index: 0, confirmed: true })).status, 409);
});
test("cover letters, interview sessions and coach histories are private", async () => {
  const { CoverLetter, InterviewSession } = await import("../Models/CareerWorkspace.Model.js");
  const letter = await CoverLetter.create({ userEmail: "workspace@example.com", title: "Letter", content: "Candidate authored letter" });
  assert.equal((await api("put", `career/cover-letters/${letter._id}`, { title: "Edited", content: "Edited letter" })).status, 200);
  assert.equal((await api("get", `career/cover-letters/${letter._id}`, undefined, stranger)).status, 404);
  const interview = await InterviewSession.create({ userEmail: "workspace@example.com", resume: resumeId, questions: ["Describe a project you built."] });
  assert.equal((await api("get", `career/interviews/${interview._id}`, undefined, stranger)).status, 404);
  assert.equal((await api("post", `career/interviews/${interview._id}/answer`, { answer: "My answer" }, stranger)).status, 404);
  assert.equal((await api("get", `career/coach/${resumeId}`, undefined, stranger)).status, 404);
});
test("public slugs, QR codes and visibility remain under owner control", async () => {
  assert.equal((await api("patch", `resume/${resumeId}/slug`, { slug: "test-candidate" }, stranger)).status, 404);
  assert.equal((await api("patch", `resume/${resumeId}/slug`, { slug: "test-candidate" })).status, 200);
  assert.equal((await request.get("/api/v1/resume/public/test-candidate")).status, 404);
  await api("patch", `resume/visibility/${resumeId}`, { isPublic: true });
  assert.equal((await request.get("/api/v1/resume/public/test-candidate")).status, 200);
  const qr = await api("get", `resume/${resumeId}/qr`); assert.equal(qr.status, 200); assert.match(qr.headers["content-type"], /image\/png/);
});
