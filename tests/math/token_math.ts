import { web3 } from "@coral-xyz/anchor";
import Decimal from "decimal.js";

export const TOKEN_DECIMALS = 6;
export const MULTIPLIER = BigInt(1e19);
export const SUPPLY_MULTIPLIER = BigInt(1e4);
export const MAX_TOKEN_SUPPLY = BigInt(10e8) * BigInt(1e6);
export const FEE_RATE_BASIS_POINT = BigInt(1e8);
const FIND_ROOT_MAX_ERROR = BigInt(1e5);

export declare type CurveParams = {
  n: number;
  k_with_multiplier_sol: bigint;
  c_with_sol: bigint;
  token_supply_at_boundary: bigint;
  native_amount_at_boundary: bigint;
};

export const CURVE_1_PARAMS: CurveParams = {
  n: 4,
  k_with_multiplier_sol: BigInt("70000000000000000000") * BigInt(web3.LAMPORTS_PER_SOL),
  c_with_sol: BigInt("7000000000"),
  token_supply_at_boundary: (MAX_TOKEN_SUPPLY * BigInt(80)) / BigInt(100),
  native_amount_at_boundary: BigInt(10089843750),
};
export const CURVE_2_PARAMS: CurveParams = {
  n: 2,
  k_with_multiplier_sol: BigInt("218750000000000000000") * BigInt(web3.LAMPORTS_PER_SOL),
  c_with_sol: BigInt("24089843750"),
  token_supply_at_boundary: (MAX_TOKEN_SUPPLY * BigInt(5)) / BigInt(100),
  native_amount_at_boundary: BigInt(8725910156250),
};
export const CURVE_3_PARAMS: CurveParams = {
  n: 1,
  k_with_multiplier_sol: BigInt("8750000000000000000000") * BigInt(web3.LAMPORTS_PER_SOL),
  c_with_sol: BigInt("8774089843750"),
  token_supply_at_boundary: BigInt(1),
  native_amount_at_boundary: BigInt("874999999999991225910156250"), // only 1 token left when calculating the curve's native_amount
};
export const CURVE_LAST_PARAMS = CURVE_3_PARAMS;

export const CURVES: Array<CurveParams> = [CURVE_1_PARAMS, CURVE_2_PARAMS, CURVE_3_PARAMS];

export function find_root(
  remaining_token_supply: bigint,
  remaining_token_supply_native_amount: bigint,
  pay_amount: bigint,
  params: CurveParams
): bigint {
  let target_native_amount = remaining_token_supply_native_amount + pay_amount;
  if (params.k_with_multiplier_sol == CURVE_LAST_PARAMS.k_with_multiplier_sol) {
    let numerator = CURVE_LAST_PARAMS.k_with_multiplier_sol;
    let denominator = (target_native_amount + CURVE_LAST_PARAMS.c_with_sol) * (MULTIPLIER / MAX_TOKEN_SUPPLY);
    let remaining_token_supply_target = ceil_div(numerator, denominator);
    if (remaining_token_supply_target >= remaining_token_supply) {
      throw new Error("Buy amount too large");
    }
    return remaining_token_supply - remaining_token_supply_target;
  }

  let low = params.token_supply_at_boundary;
  let high = remaining_token_supply;
  while (high - low > FIND_ROOT_MAX_ERROR) {
    let mid = (low + high) >> BigInt(1);
    let y = calculate_curve(mid, true, params);
    if (target_native_amount > y) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return remaining_token_supply - high;
}

export function calculate_curve(target_token_supply: bigint, round_up: boolean, params: CurveParams): bigint {
  let pow_x: bigint;
  if (params.n > 1) {
    pow_x = pow(target_token_supply, BigInt(params.n), round_up);
  } else {
    pow_x = target_token_supply * SUPPLY_MULTIPLIER;
  }

  let y = div_with_rounding(params.k_with_multiplier_sol, pow_x, round_up);
  return y - params.c_with_sol;
}

export function search_curve(target_token_supply: bigint): CurveParams {
  for (let curve of CURVES) {
    if (target_token_supply > curve.token_supply_at_boundary) {
      return curve;
    }
  }
  return CURVE_LAST_PARAMS;
}

export function calculate_price(target_token_supply: bigint, y: bigint, curve: CurveParams): Decimal {
  let x_dec = new Decimal(target_token_supply.toString()).div(new Decimal(1e6));
  let y_dec = new Decimal((y + curve.c_with_sol).toString()).div(new Decimal(web3.LAMPORTS_PER_SOL));
  let Decimal15 = Decimal.set({ precision: 15, rounding: Decimal.ROUND_DOWN });
  let n_dec = new Decimal15(curve.n);
  return n_dec.mul(y_dec).div(x_dec);
}

export function calculate_market_cap(price: Decimal): Decimal {
  return price.mul(new Decimal(MAX_TOKEN_SUPPLY.toString()).div(new Decimal(1e6)));
}

export function div_with_rounding(numerator: bigint, denominator: bigint, round_up: boolean): bigint {
  let quotient = numerator / denominator;

  if (round_up && numerator % denominator != BigInt(0)) {
    return quotient + BigInt(1);
  } else {
    return quotient;
  }
}

export function ceil_div(a: bigint, b: bigint): bigint {
  let r = a / b;
  if (r * b == a) {
    return r;
  } else {
    return r + BigInt(1);
  }
}

function pow(target_supply: bigint, n: bigint, round_up: boolean): bigint {
  let result = MULTIPLIER;
  let base = target_supply * SUPPLY_MULTIPLIER;

  while (n > BigInt(0)) {
    if (n % BigInt(2) == BigInt(1)) {
      result = result * base;
      result = div_with_rounding(result, MULTIPLIER, round_up);
    }
    base = base * base;
    base = div_with_rounding(base, MULTIPLIER, round_up);
    n /= BigInt(2);
  }
  return result;
}
