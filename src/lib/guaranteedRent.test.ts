import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessGuaranteedRent,
  confidenceFromDataQuality,
  fixedCostsAnnual,
  FIXED_COSTS_ANNUAL_BY_BEDROOMS,
  MEDIUM_BAND_FLOOR,
  TARGET_ANNUAL_PROFIT,
} from './guaranteedRent.ts';
import { TRUE_NET_PCT } from './analysis.ts';

// A gross revenue that produces exactly `profit` of annual profit at the given
// rent and bedroom count, so a test can sit precisely ON a band boundary.
//
// It varies gross rather than rent because rents are whole pounds: profit moves
// in £12 steps as the rent changes, so £7,999 is simply not reachable by
// choosing a rent. Net revenue moves in £1 steps, so it is.
function grossForProfit(rentMonthly: number, bedrooms: number, profit: number): number {
  const targetNet = profit + rentMonthly * 12 + FIXED_COSTS_ANNUAL_BY_BEDROOMS[bedrooms];
  const approx = Math.round(targetNet / TRUE_NET_PCT);
  for (const candidate of [approx, approx - 1, approx + 1]) {
    if (Math.round(candidate * TRUE_NET_PCT) === targetNet) return candidate;
  }
  throw new Error(`no whole-pound gross yields a profit of ${profit}`);
}

describe('fixedCostsAnnual', () => {
  test('matches the deal model table', () => {
    assert.equal(fixedCostsAnnual(1).amount, 4104);
    assert.equal(fixedCostsAnnual(2).amount, 4704);
    assert.equal(fixedCostsAnnual(3).amount, 5304);
    assert.equal(fixedCostsAnnual(4).amount, 5904);
    assert.equal(fixedCostsAnnual(5).amount, 6504);
  });

  test('the 4-bed figure is the constant analysis.ts already used', () => {
    // (FIXED_BILLS_MONTHLY 450 + FIXED_SOFTWARE_MONTHLY 42) * 12
    assert.equal(fixedCostsAnnual(4).amount, (450 + 42) * 12);
  });

  test('rises by exactly £600/yr per bedroom', () => {
    for (let beds = 2; beds <= 5; beds += 1) {
      assert.equal(
        FIXED_COSTS_ANNUAL_BY_BEDROOMS[beds] - FIXED_COSTS_ANNUAL_BY_BEDROOMS[beds - 1],
        600,
      );
    }
  });

  test('studios are charged at the 1-bed rate, not treated as unknown', () => {
    const result = fixedCostsAnnual(0);
    assert.equal(result.amount, 4104);
    assert.equal(result.bedroomsUsed, 1);
    assert.equal(result.assumedDefault, false);
  });

  test('anything above 5 beds is charged at the 5+ rate', () => {
    assert.equal(fixedCostsAnnual(9).amount, 6504);
    assert.equal(fixedCostsAnnual(9).bedroomsUsed, 5);
  });

  test('unknown bedrooms fall back to the 4-bed figure and are flagged', () => {
    for (const value of [null, undefined, NaN]) {
      const result = fixedCostsAnnual(value as number | null | undefined);
      assert.equal(result.amount, 5904, `for ${String(value)}`);
      assert.equal(result.bedroomsUsed, 4);
      assert.equal(result.assumedDefault, true);
    }
  });
});

describe('confidenceFromDataQuality', () => {
  test("translates the analyser's 'moderate' to 'medium'", () => {
    assert.equal(confidenceFromDataQuality({ level: 'moderate' }), 'medium');
  });

  test('passes high and low through', () => {
    assert.equal(confidenceFromDataQuality({ level: 'high' }), 'high');
    assert.equal(confidenceFromDataQuality({ level: 'low' }), 'low');
  });

  test('missing quality is treated as low, never high', () => {
    assert.equal(confidenceFromDataQuality(null), 'low');
    assert.equal(confidenceFromDataQuality(undefined), 'low');
  });
});

describe('assessGuaranteedRent — the worked example', () => {
  // 3-bed grossing £45,000, landlord wants £1,200/mo.
  //   STR net        = 45,000 x 0.44         = 19,800
  //   annual rent    = 1,200 x 12            = 14,400
  //   fixed costs    = 3 bed                 =  5,304
  //   annual profit  = 19,800 - 14,400 - 5,304 =    96
  //   required gross = (14,400 + 5,304 + 8,000) / 0.44 = 62,964
  const assessment = assessGuaranteedRent({
    grossStrAnnual: 45000,
    desiredRentMonthly: 1200,
    bedrooms: 3,
    confidence: 'high',
  });

  test('computes every figure in the brief', () => {
    assert.equal(assessment.strNetAnnual, 19800);
    assert.equal(assessment.annualRent, 14400);
    assert.equal(assessment.fixedCostsAnnual, 5304);
    assert.equal(assessment.annualProfit, 96);
    assert.equal(assessment.requiredGrossAnnual, 62964);
    assert.equal(assessment.gapAnnual, 45000 - 62964);
    assert.equal(assessment.revenueMultiple, 3.13);
  });

  test('bands as unqualified and caps the offer below the ask', () => {
    assert.equal(assessment.band, 'UNQUALIFIED');
    assert.equal(assessment.offerMeetsAsk, false);
    assert.ok(assessment.offerRentMonthly! < 1200);
  });

  test('the figures reconcile — profit is net minus rent minus fixed costs', () => {
    assert.equal(
      assessment.annualProfit,
      assessment.strNetAnnual! - assessment.annualRent! - assessment.fixedCostsAnnual,
    );
  });

  test('required gross is the revenue that would hit the target exactly', () => {
    const atRequired = assessGuaranteedRent({
      grossStrAnnual: assessment.requiredGrossAnnual!,
      desiredRentMonthly: 1200,
      bedrooms: 3,
    });
    // Within a pound of the target, after whole-pound rounding.
    assert.ok(Math.abs(atRequired.annualProfit! - TARGET_ANNUAL_PROFIT) <= 1);
    assert.equal(atRequired.band, 'QUALIFIED');
  });
});

describe('assessGuaranteedRent — band boundaries', () => {
  const RENT = 1000;
  const BEDS = 2;

  function atProfit(profit: number) {
    return assessGuaranteedRent({
      grossStrAnnual: grossForProfit(RENT, BEDS, profit),
      desiredRentMonthly: RENT,
      bedrooms: BEDS,
    });
  }

  test('exactly £8,000 profit is QUALIFIED', () => {
    const result = atProfit(TARGET_ANNUAL_PROFIT);
    assert.equal(result.annualProfit, TARGET_ANNUAL_PROFIT);
    assert.equal(result.band, 'QUALIFIED');
  });

  test('£7,999 profit drops to MEDIUM', () => {
    const result = atProfit(TARGET_ANNUAL_PROFIT - 1);
    assert.equal(result.annualProfit, TARGET_ANNUAL_PROFIT - 1);
    assert.equal(result.band, 'MEDIUM');
  });

  test('exactly £4,000 profit is MEDIUM', () => {
    const result = atProfit(MEDIUM_BAND_FLOOR);
    assert.equal(result.annualProfit, MEDIUM_BAND_FLOOR);
    assert.equal(result.band, 'MEDIUM');
  });

  test('£3,999 profit drops to UNQUALIFIED', () => {
    const result = atProfit(MEDIUM_BAND_FLOOR - 1);
    assert.equal(result.annualProfit, MEDIUM_BAND_FLOOR - 1);
    assert.equal(result.band, 'UNQUALIFIED');
  });

  test('the printed profit always agrees with the band', () => {
    // Rounding happens before banding, so there is never a report showing
    // £7,999 next to the word QUALIFIED.
    for (let rent = 500; rent <= 2500; rent += 7.37) {
      const result = assessGuaranteedRent({
        grossStrAnnual: 60000,
        desiredRentMonthly: rent,
        bedrooms: BEDS,
      });
      const expected =
        result.annualProfit! >= TARGET_ANNUAL_PROFIT
          ? 'QUALIFIED'
          : result.annualProfit! >= MEDIUM_BAND_FLOOR
            ? 'MEDIUM'
            : 'UNQUALIFIED';
      assert.equal(result.band, expected, `at rent ${rent}`);
    }
  });
});

describe('assessGuaranteedRent — the offer', () => {
  test('offers the asking rent when we can afford it', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 80000,
      desiredRentMonthly: 1000,
      bedrooms: 2,
    });
    assert.equal(result.band, 'QUALIFIED');
    assert.equal(result.offerRentMonthly, 1000);
    assert.equal(result.offerMeetsAsk, true);
    assert.equal(result.hasOffer, true);
  });

  test('never offers more than the landlord asked for', () => {
    // Affordable well above the ask — the offer must still be the ask.
    const result = assessGuaranteedRent({
      grossStrAnnual: 200000,
      desiredRentMonthly: 900,
      bedrooms: 2,
    });
    assert.ok(result.maxAffordableRentMonthly! > 900);
    assert.equal(result.offerRentMonthly, 900);
  });

  test('caps at the maximum affordable when the ask is too high', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 60000,
      desiredRentMonthly: 2500,
      bedrooms: 2,
    });
    assert.equal(result.band, 'UNQUALIFIED');
    assert.equal(result.offerMeetsAsk, false);
    assert.equal(result.offerRentMonthly, result.maxAffordableRentMonthly);
  });

  test('the capped offer leaves at least the target profit', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 60000,
      desiredRentMonthly: 2500,
      bedrooms: 2,
    });
    const profitAtOffer =
      result.strNetAnnual! - result.offerRentMonthly! * 12 - result.fixedCostsAnnual;
    assert.ok(
      profitAtOffer >= TARGET_ANNUAL_PROFIT,
      `flooring the offer must never undershoot the target (got ${profitAtOffer})`,
    );
    // ...and not by more than a month's worth of rounding.
    assert.ok(profitAtOffer < TARGET_ANNUAL_PROFIT + 12);
  });

  test('makes no offer when the property cannot cover costs and target', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 12000,
      desiredRentMonthly: 800,
      bedrooms: 2,
    });
    assert.equal(result.hasOffer, false);
    assert.equal(result.offerRentMonthly, 0);
    assert.equal(result.offerMeetsAsk, false);
    assert.equal(result.band, 'UNQUALIFIED');
    assert.match(result.reason, /No viable offer/);
  });

  test('the offer is never negative', () => {
    for (const gross of [0.01, 1000, 5000, 13000, 14000]) {
      const result = assessGuaranteedRent({
        grossStrAnnual: gross,
        desiredRentMonthly: 800,
        bedrooms: 5,
      });
      assert.ok(
        result.offerRentMonthly === null || result.offerRentMonthly >= 0,
        `gross ${gross} produced ${result.offerRentMonthly}`,
      );
    }
  });
});

describe('assessGuaranteedRent — insufficient data', () => {
  test('is not banded when short-let revenue is missing', () => {
    for (const gross of [null, undefined, 0, NaN]) {
      const result = assessGuaranteedRent({
        grossStrAnnual: gross as number | null | undefined,
        desiredRentMonthly: 1000,
        bedrooms: 2,
      });
      assert.equal(result.band, 'INSUFFICIENT_DATA', `for gross ${String(gross)}`);
      assert.equal(result.annualProfit, null);
      assert.equal(result.hasOffer, false);
      assert.match(result.reason, /short-let revenue/);
    }
  });

  test('is not banded when desired rent is missing', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 50000,
      desiredRentMonthly: null,
      bedrooms: 2,
    });
    assert.equal(result.band, 'INSUFFICIENT_DATA');
    assert.equal(result.offerRentMonthly, null);
    assert.match(result.reason, /desired rent/);
  });

  test('still reports the fixed costs it would have used', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: null,
      desiredRentMonthly: null,
      bedrooms: 3,
    });
    assert.equal(result.fixedCostsAnnual, 5304);
    assert.match(result.reason, /short-let revenue and desired rent/);
  });
});

describe('assessGuaranteedRent — reported caveats', () => {
  test('flags assumed bedrooms in the reason', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 80000,
      desiredRentMonthly: 1000,
      bedrooms: null,
    });
    assert.equal(result.bedroomsAssumed, true);
    assert.match(result.reason, /bedrooms unknown/);
  });

  test('flags estimated inputs in the reason', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 80000,
      desiredRentMonthly: 1000,
      bedrooms: 2,
      desiredRentIsEstimate: true,
      grossStrIsEstimate: true,
    });
    assert.match(result.reason, /rent estimated/);
    assert.match(result.reason, /revenue estimated/);
  });

  test('says nothing about caveats when every figure is confirmed', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 80000,
      desiredRentMonthly: 1000,
      bedrooms: 2,
    });
    assert.doesNotMatch(result.reason, /estimated|unknown/);
  });

  test('defaults confidence to low rather than assuming the best', () => {
    const result = assessGuaranteedRent({
      grossStrAnnual: 80000,
      desiredRentMonthly: 1000,
      bedrooms: 2,
    });
    assert.equal(result.confidence, 'low');
  });
});
