import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// SPEC-198 · search/filter kini via API: BacklogScreen mengirim q/stage/priority ke listSpecs,
// server yang menyaring. Test ini memverifikasi PARAM yang dikirim, bukan penyaringan klien.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [] })), listSpecs: vi.fn() },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import { api } from "../src/api/client";

const envelope = (items: unknown[] = []) => ({ items, total: items.length, page: 1, pageSize: 20 });
beforeEach(() => { vi.mocked(api.listSpecs).mockReset(); vi.mocked(api.listSpecs).mockResolvedValue(envelope()); });
const lastParams = () => vi.mocked(api.listSpecs).mock.calls.at(-1)![0];

function renderBacklog() {
  return render(
    <BacklogScreen backlog={[] as never}
      projects={[{ id: "arta", name: "arta" }] as never}
      projectFilter="all" onProjectFilter={() => {}} />
  );
}

describe("search + filter backlog via API (SPEC-178 → SPEC-198)", () => {
  it("mengirim q ke API saat mengetik (debounced)", async () => {
    renderBacklog();
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "csv" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ q: "csv" }));
  });

  it("mengirim stage ke API", async () => {
    renderBacklog();
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ stage: "planned" }));
  });

  it("mengirim priority ke API", async () => {
    renderBacklog();
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "rendah" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ priority: "rendah" }));
  });

  it("kombinasi search + stage + priority = satu query berisi ketiganya", async () => {
    renderBacklog();
    fireEvent.change(screen.getByPlaceholderText("Cari backlog…"), { target: { value: "alpha" } });
    fireEvent.change(screen.getByLabelText("Filter stage"), { target: { value: "planned" } });
    fireEvent.change(screen.getByLabelText("Filter prioritas"), { target: { value: "tinggi" } });
    await waitFor(() => expect(lastParams()).toMatchObject({ q: "alpha", stage: "planned", priority: "tinggi" }));
  });

  it("tanpa filter: params tanpa q/stage/priority (server balikkan semua)", async () => {
    renderBacklog();
    await waitFor(() => expect(api.listSpecs).toHaveBeenCalled());
    expect(lastParams()).toMatchObject({ q: undefined, stage: undefined, priority: undefined });
  });
});
