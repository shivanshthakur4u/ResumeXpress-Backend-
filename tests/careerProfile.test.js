import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import supertest from "supertest";

let mongo;
let request;
let mongoose;

before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.NODE_ENV = "test";
  process.env.DB_URI = mongo.getUri();
  process.env.JWT_SECRET = "test-secret-that-is-long-enough-to-pass-validation";
  process.env.FRONTEND_URL = "http://localhost:3000";

  const [{ default: app }, mongooseMod] = await Promise.all([
    import("../index.js"),
    import("mongoose"),
  ]);
  mongoose = mongooseMod.default;
  request = supertest(app);
});

after(async () => {
  await mongoose?.disconnect();
  await mongo?.stop();
});

const authFor = async (email, name = "Ada Lovelace") => {
  const res = await request
    .post("/api/v1/user/register")
    .send({ name, email, password: "Password123" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.token;
};

const createResume = async (token, title) => {
  const res = await request
    .post("/api/v1/resume/createResume")
    .set("Authorization", `Bearer ${token}`)
    .send({ title });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body._id;
};

const getProfile = (token) =>
  request.get("/api/v1/career-profile").set("Authorization", `Bearer ${token}`);

const putProfile = (token, body) =>
  request
    .put("/api/v1/career-profile")
    .set("Authorization", `Bearer ${token}`)
    .send(body);

describe("career profile access", () => {
  test("requires authentication", async () => {
    const res = await request.get("/api/v1/career-profile");
    assert.equal(res.status, 401);
  });

  test("is created on first read and seeded from the account", async () => {
    const token = await authFor("profile-new@example.com", "Ada Lovelace");
    const res = await getProfile(token);

    assert.equal(res.status, 200);
    assert.equal(res.body.profile.firstName, "Ada");
    assert.equal(res.body.profile.lastName, "Lovelace");
    assert.equal(res.body.profile.email, "profile-new@example.com");

    // Internal ownership fields are never returned.
    assert.equal(res.body.profile.user, undefined);
    assert.equal(res.body.profile.userEmail, undefined);
  });

  test("reading twice does not create a second profile", async () => {
    const token = await authFor("profile-once@example.com");
    const first = await getProfile(token);
    const second = await getProfile(token);
    assert.equal(first.body.profile._id, second.body.profile._id);
  });

  test("one user cannot see another user's profile", async () => {
    const alice = await authFor("p-alice@example.com", "Alice Smith");
    const bob = await authFor("p-bob@example.com", "Bob Jones");

    await putProfile(alice, { jobTitle: "Alice's secret role" });
    const bobsProfile = await getProfile(bob);

    assert.equal(bobsProfile.body.profile.firstName, "Bob");
    assert.notEqual(bobsProfile.body.profile.jobTitle, "Alice's secret role");
  });
});

describe("career profile updates", () => {
  test("cannot reassign ownership through the body", async () => {
    const victim = await authFor("p-victim@example.com", "Vic Tim");
    const attacker = await authFor("p-attacker@example.com", "At Tacker");

    const res = await putProfile(attacker, {
      jobTitle: "Engineer",
      userEmail: "p-victim@example.com",
    });
    assert.equal(res.status, 200);

    // The victim's profile is untouched and still their own.
    const victimProfile = await getProfile(victim);
    assert.equal(victimProfile.body.profile.firstName, "Vic");
    assert.notEqual(victimProfile.body.profile.jobTitle, "Engineer");
  });

  test("rejects an empty update", async () => {
    const token = await authFor("p-empty@example.com");
    const res = await putProfile(token, {});
    assert.equal(res.status, 400);
  });

  test("merges preferences rather than replacing them", async () => {
    const token = await authFor("p-prefs@example.com");

    await putProfile(token, {
      preferences: { targetRoles: ["Backend Engineer"], noticePeriod: "1 month" },
    });
    await putProfile(token, { preferences: { remotePreference: "remote" } });

    const res = await getProfile(token);
    assert.deepEqual(res.body.profile.preferences.targetRoles, [
      "Backend Engineer",
    ]);
    assert.equal(res.body.profile.preferences.noticePeriod, "1 month");
    assert.equal(res.body.profile.preferences.remotePreference, "remote");
  });
});

describe("completeness scoring", () => {
  test("rises as sections are filled and reports what is missing", async () => {
    const token = await authFor("p-score@example.com");

    const empty = await getProfile(token);
    assert.equal(empty.body.completeness.score, 0);
    assert.ok(empty.body.completeness.missing.includes("Work experience"));

    await putProfile(token, { jobTitle: "Backend Engineer" });
    const withPersonal = await getProfile(token);
    assert.equal(withPersonal.body.completeness.score, 20);

    await putProfile(token, {
      summary:
        "Backend engineer who builds reliable services and cares about clear APIs.",
      experience: [{ title: "Engineer", companyName: "Acme" }],
      education: [{ universityName: "Cambridge", degree: "BSc" }],
      skills: [{ name: "Node" }, { name: "Mongo" }, { name: "TypeScript" }],
    });

    const filled = await getProfile(token);
    // personal 20 + summary 15 + experience 25 + education 15 + skills 15
    assert.equal(filled.body.completeness.score, 90);
    assert.deepEqual(filled.body.completeness.missing, [
      "Projects, certifications or awards",
    ]);

    await putProfile(token, {
      projects: [{ name: "ResumeXpress", description: "A resume builder" }],
    });
    const complete = await getProfile(token);
    assert.equal(complete.body.completeness.score, 100);
    assert.deepEqual(complete.body.completeness.missing, []);
  });
});

describe("importing a profile into a resume", () => {
  test("copies the selected sections only", async () => {
    const token = await authFor("p-import@example.com");
    const resumeId = await createResume(token, "Imported CV");

    await putProfile(token, {
      jobTitle: "Staff Engineer",
      phone: "555-0100",
      summary: "A summary long enough to count towards profile completeness.",
      experience: [{ title: "Engineer", companyName: "Acme" }],
      skills: [{ name: "Node", rating: 5, category: "Backend" }],
    });

    const res = await request
      .post(`/api/v1/career-profile/import-to-resume/${resumeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sections: ["personal", "experience"] });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.applied, ["personal", "experience"]);

    const resume = await request
      .get(`/api/v1/resume/getResumeById/${resumeId}`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(resume.body.resume.jobTitle, "Staff Engineer");
    assert.equal(resume.body.resume.phone, "555-0100");
    assert.equal(resume.body.resume.experience.length, 1);
    // Not requested, so it must not have been copied.
    assert.equal(resume.body.resume.summary, "");
    assert.equal(resume.body.resume.skills.length, 0);
  });

  test("drops the profile-only skill category the resume cannot store", async () => {
    const token = await authFor("p-import-skills@example.com");
    const resumeId = await createResume(token, "Skills CV");

    await putProfile(token, {
      skills: [{ name: "Node", rating: 5, category: "Backend" }],
    });

    await request
      .post(`/api/v1/career-profile/import-to-resume/${resumeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sections: ["skills"] });

    const resume = await request
      .get(`/api/v1/resume/getResumeById/${resumeId}`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(resume.body.resume.skills[0].name, "Node");
    assert.equal(resume.body.resume.skills[0].category, undefined);
  });

  test("rejects an unknown section name", async () => {
    const token = await authFor("p-import-bad@example.com");
    const resumeId = await createResume(token, "Bad Section CV");

    const res = await request
      .post(`/api/v1/career-profile/import-to-resume/${resumeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sections: ["projects"] });

    assert.equal(res.status, 400);
  });

  test("cannot import into another user's resume", async () => {
    const alice = await authFor("p-imp-alice@example.com");
    const bob = await authFor("p-imp-bob@example.com");
    const aliceResume = await createResume(alice, "Alice Private CV");

    const res = await request
      .post(`/api/v1/career-profile/import-to-resume/${aliceResume}`)
      .set("Authorization", `Bearer ${bob}`)
      .send({ sections: ["personal"] });

    assert.equal(res.status, 404);
  });
});

describe("syncing a resume back into the profile", () => {
  test("writes resume content to the profile", async () => {
    const token = await authFor("p-sync@example.com");
    const resumeId = await createResume(token, "Source CV");

    await request
      .put(`/api/v1/resume/updateResume/${resumeId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        jobTitle: "Principal Engineer",
        experience: [{ title: "Lead", companyName: "Globex" }],
      });

    const res = await request
      .post(`/api/v1/career-profile/sync-from-resume/${resumeId}`)
      .set("Authorization", `Bearer ${token}`);

    assert.equal(res.status, 200);
    assert.ok(res.body.updated.includes("jobTitle"));

    const profile = await getProfile(token);
    assert.equal(profile.body.profile.jobTitle, "Principal Engineer");
    assert.equal(profile.body.profile.experience[0].companyName, "Globex");
  });

  test("an empty resume does not blank out existing profile data", async () => {
    const token = await authFor("p-sync-empty@example.com");
    await putProfile(token, {
      jobTitle: "Staff Engineer",
      experience: [{ title: "Engineer", companyName: "Acme" }],
    });

    // A brand new resume with nothing filled in.
    const emptyResume = await createResume(token, "Empty CV");

    await request
      .post(`/api/v1/career-profile/sync-from-resume/${emptyResume}`)
      .set("Authorization", `Bearer ${token}`);

    const profile = await getProfile(token);
    assert.equal(profile.body.profile.jobTitle, "Staff Engineer");
    assert.equal(profile.body.profile.experience.length, 1);
  });

  test("cannot sync from another user's resume", async () => {
    const alice = await authFor("p-sync-alice@example.com");
    const bob = await authFor("p-sync-bob@example.com");
    const aliceResume = await createResume(alice, "Alice Sync CV");

    const res = await request
      .post(`/api/v1/career-profile/sync-from-resume/${aliceResume}`)
      .set("Authorization", `Bearer ${bob}`);

    assert.equal(res.status, 404);
  });
});
