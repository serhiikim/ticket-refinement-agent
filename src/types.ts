export type TriggerReason =
  | "initial_analysis"
  | "clarification_reply"
  | "refinement_reply"
  | "code_trigger";

export interface GenericTicketEvent {
  platform: "github" | "jira" | "asana";
  triggerReason: TriggerReason;
  /** Unique ticket identifier, e.g. "org/repo#123" for GitHub */
  ticketId: string;
  /** Maps to a key in config.repos, e.g. "org/repo" */
  repoIdentifier: string;
}

export interface TicketContext {
  ticketId: string;
  title: string;
  body: string;
  labels: string[];
}

export interface TicketComment {
  id: string;
  body: string;
  authorLogin: string;
  authorType: "user" | "bot";
  /** True when this comment was posted by the agent itself */
  isAgentComment: boolean;
  createdAt: string;
}

export interface ITicketProvider {
  getTicket(id: string): Promise<TicketContext>;
  getComments(id: string): Promise<TicketComment[]>;
  postComment(id: string, body: string): Promise<void>;
  updateDescription(id: string, newBody: string): Promise<void>;
  /** Transitions the ticket to the given abstract workflow state */
  updateStatus(id: string, status: "clarifying" | "enhanced" | "done"): Promise<void>;
}

export interface ISourceControlProvider {
  createDraftPr(
    title: string,
    baseBranch: string,
    featureBranch: string,
    linkedTicket: { platform: string; id: string; url: string }
  ): Promise<string>;
}

export interface IWebhookAdapter {
  verifySignature(rawBody: string, headers: Record<string, string>): boolean;
  /** Returns a GenericTicketEvent or null if the event should be ignored */
  parseEvent(eventType: string, payload: Record<string, unknown>): GenericTicketEvent | null;
}
