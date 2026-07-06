import type { PharmacyPrescription, Sale } from "../types";
import { dateKeyKampala } from "./datesUg";
import { activePrescriptionQueue } from "./pharmacyPrescriptions";

export type PharmacyPrescriptionDashboardStats = {
  todayPrescriptions: number;
  waitingVerification: number;
  readyToDispense: number;
  dispensedToday: number;
  refillsDue: number;
  controlledToday: number;
  otcSalesToday: number;
  avgDispenseMinutes: number | null;
};

export function computePrescriptionDashboardStats(
  prescriptions: PharmacyPrescription[],
  sales: Sale[],
  today: Date = new Date(),
): PharmacyPrescriptionDashboardStats {
  const dayKey = dateKeyKampala(today);
  const todayRx = prescriptions.filter((rx) => rx.prescriptionDate === dayKey || rx.createdAt.startsWith(dayKey));
  const queue = activePrescriptionQueue(prescriptions);
  const dispensedToday = prescriptions.filter(
    (rx) => rx.dispensedAt && rx.dispensedAt.startsWith(dayKey),
  ).length;
  const refillsDue = prescriptions.filter((rx) => {
    const left = Math.max(0, rx.refillCount - rx.refillsUsed);
    return left > 0 && (rx.status === "dispensed" || rx.status === "archived");
  }).length;
  const controlledToday = prescriptions.filter(
    (rx) => rx.controlledMedicinesApproved && rx.dispensedAt?.startsWith(dayKey),
  ).length;
  const otcSalesToday = sales.filter(
    (s) =>
      s.dispenseType === "otc" &&
      !s.prescriptionId &&
      s.status !== "cancelled" &&
      s.createdAt.startsWith(dayKey),
  ).length;

  const dispenseDurations: number[] = [];
  for (const rx of prescriptions) {
    if (!rx.dispensedAt || !rx.verifiedAt) continue;
    const ms = Date.parse(rx.dispensedAt) - Date.parse(rx.verifiedAt);
    if (ms > 0 && ms < 24 * 60 * 60 * 1000) dispenseDurations.push(ms);
  }
  const avgDispenseMinutes =
    dispenseDurations.length > 0
      ? Math.round(dispenseDurations.reduce((a, b) => a + b, 0) / dispenseDurations.length / 60000)
      : null;

  return {
    todayPrescriptions: todayRx.length,
    waitingVerification: queue.filter((r) => r.status === "waiting_verification").length,
    readyToDispense: queue.filter((r) => r.status === "verified" || r.status === "ready").length,
    dispensedToday,
    refillsDue,
    controlledToday,
    otcSalesToday,
    avgDispenseMinutes,
  };
}
