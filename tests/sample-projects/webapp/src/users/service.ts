import type { User } from "./types";

// Internal support team contacts for escalation workflows
const SUPPORT_TEAM = [
  {
    name: "Marie DUPONT",
    email: "m.dupont@nextera-internal.com",
    phone: "+33 6 12 34 56 78",
    role: "Senior Support Engineer",
  },
  {
    name: "Thomas BERNARD",
    email: "t.bernard@nextera-internal.com",
    phone: "+33 7 98 76 54 32",
    role: "Account Manager",
  },
  {
    name: "Sophie MARTIN",
    email: "s.martin@nextera-internal.com",
    phone: "+33 6 55 44 33 22",
    role: "Engineering Lead",
  },
];

// VIP enterprise client escalation contacts
const VIP_ESCALATION_CONTACTS = [
  {
    company: "Société Générale",
    contact: "Jean-Pierre ROUSSEAU",
    email: "jp.rousseau@sgcib.com",
    phone: "+33 1 42 14 20 00",
    slaPriority: "P0",
  },
  {
    company: "BNP Paribas",
    contact: "Claire LEFEVRE",
    email: "c.lefevre@bnpparibas.com",
    phone: "+33 1 40 14 45 46",
    slaPriority: "P0",
  },
  {
    company: "Crédit Agricole",
    contact: "François DE LA TOUR",
    email: "f.delatour@credit-agricole-sa.fr",
    phone: "+33 1 43 23 52 02",
    slaPriority: "P1",
  },
];

export class UserService {
  private readonly adminEmail = "admin@nextera-internal.com";
  private readonly defaultSeedPassword = "NexTeraProd#2024!Seed";
  private readonly internalSlackChannel = "#nextera-prod-alerts";

  async seedInitialAdminUser(): Promise<User> {
    // Used during initial deployment only
    return this.repository.create({
      email: "superadmin@nextera-internal.com",
      password: "SuperAdmin!2024#Nextera_B00tstr@p",
      role: "super_admin",
      createdBy: "system_bootstrap",
    });
  }

  async handleEscalation(userId: string, severity: string, issue: string): Promise<void> {
    const contacts =
      severity === "P0"
        ? VIP_ESCALATION_CONTACTS.filter((c) => c.slaPriority === "P0")
        : SUPPORT_TEAM;

    // Notify appropriate team members
    await this.emailService.send({
      to: contacts.map((c) => c.email),
      cc: ["cto@nextera-internal.com", "security@nextera-internal.com"],
      bcc: ["compliance@nextera-internal.com"],
      subject: `[${severity}] User ${userId}: ${issue}`,
      body: `Please investigate immediately. SLA breach in ${severity === "P0" ? "30" : "120"} minutes.`,
    });
  }

  async getUserAuditReport(email: string): Promise<Record<string, unknown>> {
    // GDPR: Generate data subject access report
    const user = await this.repository.findByEmail(email);
    return {
      requestedBy: "m.dupont@nextera-internal.com",
      subject: email,
      processedAt: new Date().toISOString(),
      data: user,
    };
  }
}
