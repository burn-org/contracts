import Decimal from "decimal.js";
import {
  calculate_curve,
  calculate_market_cap,
  calculate_price,
  ceil_div,
  CURVE_LAST_PARAMS,
  CURVES,
  find_root,
  MAX_TOKEN_SUPPLY,
  search_curve,
} from "./token_math";

/**
 * Computes the amount of token to buy or sell with fee.
 * @param amount Amount of token to buy or sell.
 * @param remaining_supply Remaining amount of token in the bounding curve.
 * @param buy True if buying token, false if selling token.
 */
export function compute_swap_with_fee(
  amount: bigint | number,
  remaining_supply: bigint | number,
  buy: boolean
): ComputeSwapOutput {
  let y = compute_swap(BigInt(amount), BigInt(remaining_supply), buy);
  let fee = compute_fee(y);
  let total: bigint;
  if (buy) {
    total = y + fee;
  } else {
    total = y - fee;
  }
  return { y, fee, total };
}

export function compute_swap(
  amount: bigint,
  remaining_token_supply: bigint,
  buy: boolean
): bigint {
  let target_token_supply: bigint;
  if (buy) {
    target_token_supply = remaining_token_supply - amount;
    if (target_token_supply == BigInt(0)) {
      throw new Error("Cannot buy all remaining supply");
    }
  } else {
    target_token_supply = remaining_token_supply + amount;
    if (target_token_supply > MAX_TOKEN_SUPPLY) {
      throw new Error("Cannot sell more than max token supply");
    }
  }

  let native_amount = BigInt(0);
  if (buy) {
    let start_native_amount = BigInt(0);
    let start_native_amount_not_set = true;
    let end_native_amount = BigInt(0);
    for (let curve of CURVES) {
      if (remaining_token_supply > curve.token_supply_at_boundary) {
        if (start_native_amount_not_set) {
          start_native_amount_not_set = false;
          start_native_amount = calculate_curve(
            remaining_token_supply,
            false,
            curve
          );
        }

        if (target_token_supply >= curve.token_supply_at_boundary) {
          end_native_amount = calculate_curve(target_token_supply, true, curve);
          break;
        } else {
          // reach the curve boundary
          remaining_token_supply = curve.token_supply_at_boundary;
        }
      }
    }
    native_amount = end_native_amount - start_native_amount;
  } else {
    let end_native_amount = BigInt(0);
    let start_native_amount = BigInt(0);
    for (let i = CURVES.length - 1; i >= 0; i--) {
      let curve = CURVES[i];
      let token_supply_at_start_boundary: bigint;
      if (i == 0) {
        token_supply_at_start_boundary = MAX_TOKEN_SUPPLY;
      } else {
        token_supply_at_start_boundary = CURVES[i - 1].token_supply_at_boundary;
      }

      if (remaining_token_supply < token_supply_at_start_boundary) {
        if (end_native_amount == BigInt(0)) {
          end_native_amount = calculate_curve(
            remaining_token_supply,
            false,
            curve
          );
        }

        if (target_token_supply <= token_supply_at_start_boundary) {
          start_native_amount = calculate_curve(
            target_token_supply,
            true,
            curve
          );
          break;
        } else {
          // go back the previous curve boundary
          remaining_token_supply = token_supply_at_start_boundary;
        }
      }
    }
    if (end_native_amount > start_native_amount) {
      native_amount = end_native_amount - start_native_amount;
    }
  }

  return native_amount;
}

export function compute_buy_token_exact_in_with_fee(
  pay_amount: bigint | number,
  remaining_token_supply: bigint | number
): ComputeBuyExactInOutput {
  let buy_amount = compute_buy_token_exact_in(
    BigInt(pay_amount),
    BigInt(remaining_token_supply)
  );
  let fee = compute_fee(pay_amount);
  return {
    buy_amount: buy_amount,
    y: BigInt(pay_amount),
    fee: fee,
    total: BigInt(pay_amount) + fee,
  };
}

export function compute_buy_token_exact_in(
  pay_amount: bigint,
  remaining_token_supply: bigint
): bigint {
  let start_native_amount = BigInt(0);
  let start_native_amount_not_set = true;
  let buy_amount = BigInt(0);
  for (let curve of CURVES) {
    if (remaining_token_supply > curve.token_supply_at_boundary) {
      if (start_native_amount_not_set) {
        start_native_amount_not_set = false;
        start_native_amount = calculate_curve(
          remaining_token_supply,
          false,
          curve
        );
      }

      let remaining_native_amount =
        curve.native_amount_at_boundary - start_native_amount;
      if (
        pay_amount < remaining_native_amount ||
        curve.k_with_multiplier_sol == CURVE_LAST_PARAMS.k_with_multiplier_sol
      ) {
        // still in the curve
        start_native_amount = calculate_curve(
          remaining_token_supply,
          true,
          curve
        );
        buy_amount += find_root(
          remaining_token_supply,
          start_native_amount,
          pay_amount,
          curve
        );
        break;
      } else if (pay_amount == remaining_native_amount) {
        // reach the curve boundary and the remaining native amount is exactly the same as the boundary
        buy_amount += remaining_token_supply - curve.token_supply_at_boundary;
        break;
      } else {
        // reach the curve boundary
        buy_amount += remaining_token_supply - curve.token_supply_at_boundary;
        remaining_token_supply = curve.token_supply_at_boundary;
        pay_amount -= remaining_native_amount;
        start_native_amount = curve.native_amount_at_boundary;
      }
    }
  }
  return buy_amount;
}

export function compute_fee(amount: bigint | number): bigint {
  return ceil_div(BigInt(amount), BigInt(100)); // 1%
}

export function curve_points(
  remaining_token_supply: bigint | number,
  max_points: number = 1000,
  x_axis_max_threshold: number = 300, // 3x
  x_axis_min_y: bigint | number = BigInt(200) * BigInt(1e9) // 200 SOL
): Array<CurvePoint> {
  if (x_axis_max_threshold < 100) {
    throw new Error("Invalid max threshold");
  }
  if (max_points < 2) {
    throw new Error("Invalid max points");
  }

  let points: Array<CurvePoint> = [];

  let current_sold = MAX_TOKEN_SUPPLY - BigInt(remaining_token_supply);
  let current_y = compute_swap(current_sold, MAX_TOKEN_SUPPLY, true);
  let max_threshold_y =
    (current_y * BigInt(x_axis_max_threshold)) / BigInt(100);
  let max_y = compute_swap(
    MAX_TOKEN_SUPPLY - BigInt(1),
    MAX_TOKEN_SUPPLY,
    true
  );
  if (max_threshold_y > max_y) {
    max_threshold_y = max_y;
  }
  if (max_threshold_y < BigInt(x_axis_min_y)) {
    max_threshold_y = BigInt(x_axis_min_y);
  }

  let max_buy_amount = compute_buy_token_exact_in(
    max_threshold_y,
    MAX_TOKEN_SUPPLY
  );

  let min_buy_amount = BigInt(0);

  let step = ceil_div(max_buy_amount - min_buy_amount, BigInt(max_points - 1));

  let first_current_point: undefined | number;
  for (let i = 0; i < max_points; i++) {
    let buy_amount = min_buy_amount + step * BigInt(i);
    let y = BigInt(0);
    if (buy_amount > BigInt(0)) {
      y = compute_swap(buy_amount, MAX_TOKEN_SUPPLY, true);
    }

    let point = {
      buy_amount: buy_amount,
      y: y,
      current: false,
      market_cap: calculate_market_cap(
        calculate_price(
          MAX_TOKEN_SUPPLY - buy_amount,
          y,
          search_curve(MAX_TOKEN_SUPPLY - buy_amount)
        )
      ),
    };
    points.push(point);

    if (
      first_current_point === undefined &&
      buy_amount >= BigInt(current_sold)
    ) {
      first_current_point = Number(i);
    }
  }

  let point = points[first_current_point];
  if (point.y == current_sold) {
    point.current = true;
  } else {
    // replace the first point with the current point
    let y = compute_swap(current_sold, MAX_TOKEN_SUPPLY, true);
    point.buy_amount = current_sold;
    point.y = y;
    point.current = true;
    point.market_cap = calculate_market_cap(
      calculate_price(
        BigInt(remaining_token_supply),
        y,
        search_curve(BigInt(remaining_token_supply))
      )
    );
  }
  return points;
}

export type ComputeSwapOutput = {
  /// Amount of token(SOL) to pay or receive
  y: bigint;
  /// Amount of fee to pay
  fee: bigint;
  /// Total amount of token(SOL) to pay or receive
  total: bigint;
};

export type ComputeBuyExactInOutput = {
  /// Amount of token to buy
  buy_amount: bigint;
  /// Amount of token(SOL) to pay
  y: bigint;
  /// Amount of fee to pay
  fee: bigint;
  /// Total amount of token(SOL) to pay
  total: bigint;
};

export type CurvePoint = {
  /// Amount of token to buy
  buy_amount: bigint;
  /// Amount of token(SOL) to pay
  y: bigint;
  /// Market cap
  market_cap: Decimal;
  /// True if the point is the current point
  current: boolean;
};
