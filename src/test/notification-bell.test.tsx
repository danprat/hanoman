import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotificationBell } from "../src/notifications/NotificationBell";
import { NotificationsContext } from "../src/notifications/NotificationsContext";

// Uji presentasi murni: bungkus bell dengan value context palsu.
function Harness({ unread, items }: { unread: number; items: any[] }) {
  const ctx = { items, unread, markAllRead: () => {}, clear: () => {} };
  return <NotificationsContext.Provider value={ctx}><NotificationBell /></NotificationsContext.Provider>;
}

describe("NotificationBell", () => {
  it("menampilkan badge unread", () => {
    render(<Harness unread={3} items={[]} />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("klik lonceng membuka dropdown berisi judul notifikasi", () => {
    const items = [{ id: "1", specId: "SPEC-180", title: "Notifikasi", projectId: null, createdAt: new Date().toISOString(), readAt: null }];
    render(<Harness unread={1} items={items} />);
    fireEvent.click(screen.getByLabelText("Notifikasi"));
    expect(screen.getByText(/SPEC-180/)).toBeInTheDocument();
    expect(screen.getByText("Tandai semua dibaca")).toBeInTheDocument();
  });
});
