import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReviewScreen } from "../src/screens/ReviewScreen";
import { api } from "../src/api/client";

vi.mock("../src/api/client", () => ({ api: { specReview: vi.fn(), specReviewFile: vi.fn() } }));

beforeEach(() => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts", "src/b.ts"],
    changed: [{ path: "src/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  (api.specReviewFile as any).mockResolvedValue({
    path: "src/a.ts", status: "M", binary: false, truncated: false,
    diff: "@@ -1 +1 @@\n-old\n+new", content: "new content",
  });
});

describe("ReviewScreen (SPEC-171)", () => {
  it("menampilkan changed list + memilih file changed pertama (diff hijau)", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("src/a.ts").length).toBeGreaterThan(0));
    expect(await screen.findByText("+new")).toBeInTheDocument();
  });
  it("tab Source menampilkan content", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await screen.findByText("+new");
    fireEvent.click(screen.getByText("source"));
    expect(await screen.findByText("new content")).toBeInTheDocument();
  });
});
