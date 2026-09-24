import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb, clearTestDb } from './testDb.js';
import { loginAgent } from './factories.js';
import { setupShopWithUsers, createOpeningStockDirect, cleanReportPayload } from './dailyReportFixtures.js';
import { DailyReportResolutionState } from '../src/models/DailyReportResolutionState.js';
import {
  syncResolutionStateToEffectiveVersion,
  ensureResolutionState,
} from '../src/services/dailyReportResolutionStateService.js';

const app = createApp();

beforeAll(startTestDb);
afterAll(stopTestDb);
beforeEach(clearTestDb);

async function makeReport() {
  const { shopA, product, owner } = await setupShopWithUsers();
  await createOpeningStockDirect(shopA, product, owner, 1500, '2020-01-10');
  const sales = await loginAgent(app, 'sales@test.dev');
  const res = await sales.post('/api/daily-reports').send(cleanReportPayload(shopA, product));
  return res.body.data.report._id;
}

describe('syncResolutionStateToEffectiveVersion — fail-closed behavior', () => {
  it('1. version switch succeeds when all four counters are zero', async () => {
    const reportId = await makeReport();
    await ensureResolutionState(reportId);

    const newCorrectionId = new mongoose.Types.ObjectId();
    const result = await syncResolutionStateToEffectiveVersion(reportId, newCorrectionId);
    expect(result.effectiveCorrectionId.toString()).toBe(newCorrectionId.toString());
  });

  it('2. version switch preserves zero counters', async () => {
    const reportId = await makeReport();
    await ensureResolutionState(reportId);

    const newCorrectionId = new mongoose.Types.ObjectId();
    await syncResolutionStateToEffectiveVersion(reportId, newCorrectionId);

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.reservedStockVarianceMagnitude).toBe(0);
    expect(state.activeStockVarianceMagnitude).toBe(0);
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
    expect(state.activeMoneyVarianceMagnitudeKobo).toBe(0);
  });

  it('3. rejected when reserved stock > 0', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      reservedStockVarianceMagnitude: 2,
    });

    const newCorrectionId = new mongoose.Types.ObjectId();
    await expect(syncResolutionStateToEffectiveVersion(reportId, newCorrectionId)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('4. rejected when active stock > 0', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      activeStockVarianceMagnitude: 3,
    });

    const newCorrectionId = new mongoose.Types.ObjectId();
    await expect(syncResolutionStateToEffectiveVersion(reportId, newCorrectionId)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('5. rejected when reserved money > 0', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      reservedMoneyVarianceMagnitudeKobo: 100000,
    });

    const newCorrectionId = new mongoose.Types.ObjectId();
    await expect(syncResolutionStateToEffectiveVersion(reportId, newCorrectionId)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('6. rejected when active money > 0', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      activeMoneyVarianceMagnitudeKobo: 250000,
    });

    const newCorrectionId = new mongoose.Types.ObjectId();
    await expect(syncResolutionStateToEffectiveVersion(reportId, newCorrectionId)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('7. a failed switch does not mutate any counter or effectiveCorrectionId', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      reservedStockVarianceMagnitude: 2,
      activeMoneyVarianceMagnitudeKobo: 100000,
    });

    const newCorrectionId = new mongoose.Types.ObjectId();
    await expect(syncResolutionStateToEffectiveVersion(reportId, newCorrectionId)).rejects.toThrow();

    const state = await DailyReportResolutionState.findOne({ dailySalesReportId: reportId });
    expect(state.effectiveCorrectionId).toBeNull();
    expect(state.reservedStockVarianceMagnitude).toBe(2);
    expect(state.activeStockVarianceMagnitude).toBe(0);
    expect(state.reservedMoneyVarianceMagnitudeKobo).toBe(0);
    expect(state.activeMoneyVarianceMagnitudeKobo).toBe(100000);
  });

  it('a matching effective version is a no-op (CASE A) even with non-zero counters', async () => {
    const reportId = await makeReport();
    await DailyReportResolutionState.create({
      dailySalesReportId: reportId,
      effectiveCorrectionId: null,
      activeStockVarianceMagnitude: 5,
    });

    // Same version (null) requested — nothing to reconcile, must not throw.
    const result = await syncResolutionStateToEffectiveVersion(reportId, null);
    expect(result.activeStockVarianceMagnitude).toBe(5);
    expect(result.effectiveCorrectionId).toBeNull();
  });
});
