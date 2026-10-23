import "server-only";

/** Mise en file de la génération des PDF d'un mois validé (implémentée avec pg-boss en 4.5). */
export async function enqueuePayslipPdfs(_periodId: string, _tenantId: string): Promise<void> {}
