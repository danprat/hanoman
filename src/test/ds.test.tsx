import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Button, StatusPill, Card } from "../src/ds";
describe("ds components", () => {
  it("button fires onClick", async () => {
    const fn = vi.fn(); render(<Button onClick={fn}>Go</Button>);
    screen.getByText("Go").click(); expect(fn).toHaveBeenCalled();
  });
  it("status pill shows label", () => { render(<StatusPill status="running">2 aktif</StatusPill>);
    expect(screen.getByText("2 aktif")).toBeInTheDocument(); });
  it("card renders children", () => { render(<Card>body</Card>); expect(screen.getByText("body")).toBeInTheDocument(); });
});
