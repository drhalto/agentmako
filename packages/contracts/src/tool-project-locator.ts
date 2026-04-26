import { z } from "zod";

export interface ProjectLocatorInput {
  projectId?: string;
  projectRef?: string;
}

export const ProjectLocatorInputObjectSchema = z.object({
  projectId: z.string().trim().min(1).optional(),
  projectRef: z.string().trim().min(1).optional(),
});

export const ProjectLocatorInputSchema =
  ProjectLocatorInputObjectSchema satisfies z.ZodType<ProjectLocatorInput>;
