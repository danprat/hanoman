import { z } from "zod";
export const zStage = z.enum(["brainstorming","objective","spec-ready","planned","executing","done"]);
export const zSpecSource = z.enum(["brief","qa","audit"]);
export const zDocStatus = z.enum(["ok","drift","broken"]);
export const zPriority = z.enum(["tinggi","sedang","rendah"]);
export const zProjectKind = z.enum(["from-scratch","existing"]);
export const zSeverity = z.enum(["critical","major","minor"]);
export const zErrorStatus = z.enum(["new","escalated","resolved"]);  // SPEC-249 · siklus status grup error
