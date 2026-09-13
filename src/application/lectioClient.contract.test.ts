import { describe, expect, it } from "vitest";
import type { LectioClient } from "./lectioClient";
import { createInMemoryLectioClient } from "./testing/inMemoryLectioClient";
import { lectioClient as realClient } from "../infrastructure/lectioClientAdapter";

function contract(name: string, createClient: () => LectioClient) {
  describe(`${name} LectioClient`, () => {
    it("publicerar bibliotek- och sessionsändringar genom kontraktet", () => {
      const client = createClient();
      const root = client.library.getSnapshot().nodes[0];
      const originalTitle = root.title;
      let libraryUpdates = 0;
      let sessionUpdates = 0;
      const stopLibrary = client.library.subscribe(() => {
        libraryUpdates += 1;
      });
      const stopSession = client.session.subscribe(() => {
        sessionUpdates += 1;
      });

      expect(
        client.library.updateNode(root.id, { title: "Kontraktstest" }).ok,
      ).toBe(true);
      expect(client.library.getSnapshot().nodes[0].title).toBe("Kontraktstest");
      expect(client.session.selectNode(root.id).ok).toBe(true);
      expect(client.session.setActiveView("workspace").ok).toBe(true);
      expect(libraryUpdates).toBeGreaterThan(0);
      expect(sessionUpdates).toBeGreaterThan(0);

      client.library.updateNode(root.id, { title: originalTitle });
      client.session.setActiveView("dashboard");
      stopLibrary();
      stopSession();
    });

    it("returnerar stabila felobjekt i stället för råa implementationfel", () => {
      const result = createClient().session.selectNode("saknas");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("not-found");
        expect(result.error.messageKey).toBe("lectio.error.not-found");
        expect(result.error.message).not.toContain("Zustand");
      }
    });
  });
}

contract("in-memory", createInMemoryLectioClient);
contract("real adapter", () => realClient);

describe("in-memory vertical slice", () => {
  it("skapar kurs, modul och föreläsning utan frontendberoenden", () => {
    const client = createInMemoryLectioClient();
    const course = client.library.addNode("workspace", "course", "Medicin");
    expect(course.ok).toBe(true);
    if (!course.ok) return;
    const module = client.library.addNode(course.value, "module", "Kirurgi");
    expect(module.ok).toBe(true);
    if (!module.ok) return;
    const lecture = client.library.addNode(module.value, "lecture", "Akut buk");
    expect(lecture.ok).toBe(true);
    if (!lecture.ok) return;
    client.transcript.replace(lecture.value, [
      { start: 0, end: 5, text: "Ett testsegment" },
    ]);
    expect(client.library.getSnapshot().segments).toHaveLength(1);
  });
});
