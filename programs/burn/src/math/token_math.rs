use std::u64;

use crate::{constants::MAX_TOKEN_SUPPLY, errors::Error as MyError};
use anchor_lang::{error::Error, solana_program::native_token::LAMPORTS_PER_SOL};

use super::math::{self};

const MULTIPLIER: u64 = 1e19 as u64;
const SUPPLY_MULTIPLIER: u128 = 1e4 as u128;
const FIND_ROOT_MAX_ERROR: u64 = 1e5 as u64;

pub struct CurveParams {
    /// The power of the x in the curve.
    pub n: u8,
    /// The k value in the curve.
    /// The formula is `k_with_multiplier_sol = k * MULTIPLIER * LAMPORTS_PER_SOL`.
    pub k_with_multiplier_sol: u128,
    /// The c value in the curve.
    /// The formula is `c_with_sol = c * LAMPORTS_PER_SOL`.
    pub c_with_sol: u128,
    /// Remaining token supply when reaching the curve boundary
    pub token_supply_at_boundary: u64,
    /// Native amount when reaching the curve boundary.
    ///
    /// # Formula
    /// [calculate_y(token_supply_at_boundary, true)]
    pub native_amount_at_boundary: u128,
}

pub const CURVE_1_PARAMS: &CurveParams = &CurveParams {
    n: 4,
    k_with_multiplier_sol: 70000000000000000000 * LAMPORTS_PER_SOL as u128, // 7 * MULTIPLIER * LAMPORTS_PER_SOL
    c_with_sol: 7000000000,
    token_supply_at_boundary: MAX_TOKEN_SUPPLY * 80 / 100,
    native_amount_at_boundary: 10089843750,
};
pub const CURVE_2_PARAMS: &CurveParams = &CurveParams {
    n: 2,
    k_with_multiplier_sol: 218750000000000000000 * LAMPORTS_PER_SOL as u128, // 21.875 * MULTIPLIER * LAMPORTS_PER_SOL
    c_with_sol: 24089843750,
    token_supply_at_boundary: MAX_TOKEN_SUPPLY * 5 / 100,
    native_amount_at_boundary: 8725910156250,
};
pub const CURVE_3_PARAMS: &CurveParams = &CurveParams {
    n: 1,
    k_with_multiplier_sol: 8750000000000000000000 * LAMPORTS_PER_SOL as u128, // 875 * MULTIPLIER * LAMPORTS_PER_SOL
    c_with_sol: 8774089843750,
    token_supply_at_boundary: 1,
    native_amount_at_boundary: 874999999999991225910156250, // only 1 token left when calculating the curve's native_amount
};

pub const CURVE_LAST_PARAMS: &CurveParams = CURVE_3_PARAMS;

/// All the curves in the order of their priority.
pub const CURVES: [&CurveParams; 3] = [CURVE_1_PARAMS, CURVE_2_PARAMS, CURVE_3_PARAMS];

/// Calculates the amount of token to be bought based on the remaining supply and the target native amount.
///
/// # Parameters
/// - `remaining_token_supply`: The remaining supply of the token.
/// - `remaining_token_supply_native_amount`: The native amount corresponding to the [remaining_token_supply].
/// - `pay_amount`: The amount of native tokens to be paid.
/// - `params`: The curve parameters.
///
/// # Returns
/// The amount of token to be bought.
///
/// # Examples
/// ```
/// use burn::constants::MAX_TOKEN_SUPPLY;
/// use burn::math::token_math::{calculate_curve, find_root, CURVE_1_PARAMS};
///
/// let remaining_supply = MAX_TOKEN_SUPPLY;
/// let params = CURVE_1_PARAMS;
/// let remaining_supply_native_amount = calculate_curve(remaining_supply, false, params);
/// let pay_amount = 1e9 as u128; // 1 SOL
/// let root = find_root(remaining_supply, remaining_supply_native_amount, pay_amount, params).unwrap();
/// ```
pub fn find_root(
    remaining_token_supply: u64,
    remaining_token_supply_native_amount: u128,
    pay_amount: u128,
    params: &CurveParams,
) -> Result<u64, Error> {
    let target_native_amount = remaining_token_supply_native_amount + pay_amount;
    // If the curve is last curve, we can use a more efficient algorithm.
    if params.k_with_multiplier_sol == CURVE_LAST_PARAMS.k_with_multiplier_sol {
        // y = MAX_TOKEN_SUPPLY * k / x - c
        // x = MAX_TOKEN_SUPPLY * k / (y + c)
        let numerator = CURVE_LAST_PARAMS.k_with_multiplier_sol;
        let denominator =
            (target_native_amount + CURVE_LAST_PARAMS.c_with_sol) * (MULTIPLIER / MAX_TOKEN_SUPPLY) as u128;
        let remaining_token_supply_target = math::ceil_div(numerator, denominator);
        // last token cannot be sold
        if remaining_token_supply_target >= remaining_token_supply as u128 {
            return Err(MyError::BuyAmountTooLarge.into());
        }
        return Ok(remaining_token_supply - remaining_token_supply_target as u64);
    }

    let mut low = params.token_supply_at_boundary;
    let mut high = remaining_token_supply;
    while high - low > FIND_ROOT_MAX_ERROR {
        let mid = (low + high) >> 1;
        let y = calculate_curve(mid, true, params); // round up to ensure that high is moved as little as possible
        if target_native_amount > y {
            high = mid;
        } else {
            low = mid;
        }
    }
    Ok(remaining_token_supply - high)
}

/// Calculates the native amount based on the target token supply.
///
/// # Parameters
/// - `target_token_supply`: The target token supply.
/// - `round_up`: Whether to round up the result. For buying, it should be `true`, and for selling, it should be `false`.
/// - `params`: The curve parameters.
///
/// # Returns
/// The native amount corresponding to the target token supply.
///
/// # Formula
/// The formula is `y = k / x^n - c`.
pub fn calculate_curve(target_token_supply: u64, round_up: bool, params: &CurveParams) -> u128 {
    // y = k / x^n - c
    let pow_x = if params.n > 1 {
        pow(target_token_supply, params.n, round_up)
    } else {
        target_token_supply as u128 * SUPPLY_MULTIPLIER as u128
    };

    let y = div_with_rounding(params.k_with_multiplier_sol, pow_x, round_up);
    y - params.c_with_sol
}

fn pow(target_token_supply: u64, n: u8, round_up: bool) -> u128 {
    let mut result = MULTIPLIER as u128;
    let mut base = target_token_supply as u128 * SUPPLY_MULTIPLIER;
    let mut n = n;
    while n > 0 {
        if n % 2 == 1 {
            result = result * base;
            result = div_with_rounding(result, MULTIPLIER as u128, round_up);
        }
        base = base * base;
        base = div_with_rounding(base, MULTIPLIER as u128, round_up);
        n /= 2;
    }

    result
}

fn div_with_rounding(numerator: u128, denominator: u128, round_up: bool) -> u128 {
    let quotient = numerator / denominator;

    if round_up && numerator % denominator != 0 {
        quotient + 1
    } else {
        quotient
    }
}

#[cfg(test)]
mod tests {
    use std::u64;

    use super::*;
    use crate::constants::MAX_TOKEN_SUPPLY;

    #[test]
    #[should_panic(expected = "attempt to divide by zero")]
    fn test_div_with_rounding_div_zero() {
        div_with_rounding(100, 0, true);
    }

    #[test]
    fn test_div_with_rounding_down() {
        assert_eq!(div_with_rounding(100, 3, false), 33);
    }

    #[test]
    fn test_div_with_rounding_up() {
        assert_eq!(div_with_rounding(100, 3, true), 34);
    }

    #[test]
    fn test_div_with_rounding_down_and_numerator_is_zero() {
        assert_eq!(div_with_rounding(0, 3, false), 0);
    }

    #[test]
    fn test_div_with_rounding_up_and_numerator_is_zero() {
        assert_eq!(div_with_rounding(0, 3, true), 0);
    }

    #[test]
    fn test_bounding_curve_boundary() {
        // curve 1
        // start
        assert_eq!(calculate_curve(MAX_TOKEN_SUPPLY, true, CURVE_1_PARAMS), 0);
        assert_eq!(calculate_curve(MAX_TOKEN_SUPPLY, false, CURVE_1_PARAMS), 0);
        // end
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100, true, CURVE_1_PARAMS),
            10089843750
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100, false, CURVE_1_PARAMS),
            10089843750
        );

        // curve 2
        // start
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100, true, CURVE_2_PARAMS),
            10089843750
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100, false, CURVE_2_PARAMS),
            10089843750
        );
        // end
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, true, CURVE_2_PARAMS),
            8725910156250
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, false, CURVE_2_PARAMS),
            8725910156250
        );

        // curve 3
        // start
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, true, CURVE_3_PARAMS),
            8725910156250
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, false, CURVE_3_PARAMS),
            8725910156250
        );

        // end
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, true, CURVE_LAST_PARAMS),
            8725910156250
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, false, CURVE_LAST_PARAMS),
            8725910156250
        );
        assert_eq!(
            calculate_curve(1, true, CURVE_LAST_PARAMS),
            CURVE_LAST_PARAMS.native_amount_at_boundary
        );
        assert_eq!(
            calculate_curve(1, false, CURVE_LAST_PARAMS),
            CURVE_LAST_PARAMS.native_amount_at_boundary
        );
    }

    #[test]
    fn test_curve_params() {
        let mut i = 0;
        loop {
            let curve = CURVES[i];
            let amount = calculate_curve(curve.token_supply_at_boundary, true, curve);
            assert_eq!(amount, curve.native_amount_at_boundary as u128);
            i += 1;
            if i == CURVES.len() - 1 {
                // skip the last curve
                break;
            }
        }
    }

    #[test]
    fn test_curve_1_and_percent_is_max_token_supply() {
        assert_eq!(calculate_curve(MAX_TOKEN_SUPPLY, true, CURVE_1_PARAMS), 0);
        assert_eq!(calculate_curve(MAX_TOKEN_SUPPLY, false, CURVE_1_PARAMS), 0);
    }

    #[test]
    fn test_curve_1_and_percent_is_99_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 99 / 100, true, CURVE_1_PARAMS),
            287142489 + 1
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 99 / 100, false, CURVE_1_PARAMS),
            287142489
        );
    }

    #[test]
    fn test_curve_1_and_percent_is_98_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 98 / 100, true, CURVE_1_PARAMS),
            589160493 + 1
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 98 / 100, false, CURVE_1_PARAMS),
            589160493
        );
    }

    #[test]
    fn test_curve_1_and_percent_is_97_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 97 / 100, true, CURVE_1_PARAMS),
            906988423 + 1
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 97 / 100, false, CURVE_1_PARAMS),
            906988423
        );
    }

    #[test]
    fn test_curve_2_and_percent_is_79_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 79 / 100, true, CURVE_2_PARAMS),
            10960628930 + 1
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 79 / 100, false, CURVE_2_PARAMS),
            10960628930
        );
    }

    #[test]
    fn test_curve_2_and_percent_is_63_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 63 / 100, true, CURVE_2_PARAMS),
            31024794697 + 1
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 63 / 100, false, CURVE_2_PARAMS),
            31024794697
        );
    }

    #[test]
    fn test_curve_3_and_percent_is_4_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 4 / 100, true, CURVE_3_PARAMS),
            13100910156250
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 4 / 100, false, CURVE_3_PARAMS),
            13100910156250
        );
    }

    #[test]
    fn test_curve_3_and_percent_is_1_percent_of_max_token_supply() {
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 1 / 100, true, CURVE_3_PARAMS),
            78725910156250
        );
        assert_eq!(
            calculate_curve(MAX_TOKEN_SUPPLY * 1 / 100, false, CURVE_3_PARAMS),
            78725910156250
        );
    }

    #[test]
    fn test_find_root_and_native_amount_is_0() {
        let mut i = 0;
        loop {
            let curve = CURVES[i];
            let native_amount = calculate_curve(CURVES[i + 1].token_supply_at_boundary + 1, true, curve);
            let root = find_root(curve.token_supply_at_boundary + 1, native_amount, 0, curve).unwrap();
            assert_eq!(root, 0);

            i += 1;
            if i == CURVES.len() - 1 {
                break;
            }
        }
    }

    #[test]
    fn test_find_root_and_target_supply_is_100_to_80_percent_of_max_token_supply() {
        let mut step: f64 = 0.001;
        while step <= 20_f64 {
            let buy_amount = (MAX_TOKEN_SUPPLY as f64 * step / 100_f64) as u64;
            let start_native_amount = calculate_curve(MAX_TOKEN_SUPPLY, true, CURVE_1_PARAMS);
            let end_native_amount = calculate_curve(MAX_TOKEN_SUPPLY - buy_amount, false, CURVE_1_PARAMS);
            let root = find_root(
                MAX_TOKEN_SUPPLY,
                start_native_amount,
                (end_native_amount - start_native_amount) as u128,
                CURVE_1_PARAMS,
            )
            .unwrap();
            assert!(buy_amount - root <= FIND_ROOT_MAX_ERROR * 2);
            step += 0.001;
        }
    }

    #[test]
    fn test_find_root_and_target_supply_is_80_to_5_percent_of_max_token_supply() {
        let mut step: f64 = 0.001;
        while step <= 75_f64 {
            let buy_amount = (MAX_TOKEN_SUPPLY as f64 * step / 100_f64) as u64;
            let start_native_amount = calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100, true, CURVE_2_PARAMS);
            let end_native_amount = calculate_curve(MAX_TOKEN_SUPPLY * 80 / 100 - buy_amount, false, CURVE_2_PARAMS);
            let root = find_root(
                MAX_TOKEN_SUPPLY * 80 / 100,
                start_native_amount,
                (end_native_amount - start_native_amount) as u128,
                CURVE_2_PARAMS,
            )
            .unwrap();
            assert!(buy_amount - root <= FIND_ROOT_MAX_ERROR * 2);
            step += 0.001;
        }
    }

    #[test]
    fn test_find_root_and_target_supply_is_5_to_1_percent_of_max_token_supply() {
        let mut step: f64 = 0.001_f64;
        while step <= 4_f64 {
            let buy_amount = (MAX_TOKEN_SUPPLY as f64 * step / 100_f64) as u64;
            let start_native_amount = calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, true, CURVE_3_PARAMS);
            let end_native_amount = calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100 - buy_amount, false, CURVE_3_PARAMS);
            let root = find_root(
                MAX_TOKEN_SUPPLY * 5 / 100,
                start_native_amount,
                (end_native_amount - start_native_amount) as u128,
                CURVE_3_PARAMS,
            )
            .unwrap();
            assert!(buy_amount - root <= FIND_ROOT_MAX_ERROR);

            step += 0.001;
        }
    }

    #[test]
    #[should_panic(expected = "BuyAmountTooLarge")]
    fn test_find_root_and_pay_amount_is_u64_max() {
        let amount = find_root(
            2,
            calculate_curve(2, true, CURVE_LAST_PARAMS),
            u64::MAX as u128,
            CURVE_LAST_PARAMS,
        )
        .unwrap();
        assert_eq!(amount, 1);
    }

    #[test]
    #[should_panic(expected = "BuyAmountTooLarge")]
    fn test_find_root_and_pay_amount_is_u64_max_and_remaining_token_supply_is_1() {
        let amount = find_root(
            1,
            calculate_curve(1, true, CURVE_LAST_PARAMS),
            u64::MAX as u128,
            CURVE_LAST_PARAMS,
        )
        .unwrap();
        assert_eq!(amount, 1);
    }

    #[test]
    fn test_find_root_and_pay_amount_is_u64_max_and_remaining_token_supply_is_5_percent_of_max_supply() {
        let amount = find_root(
            MAX_TOKEN_SUPPLY * 5 / 100,
            calculate_curve(MAX_TOKEN_SUPPLY * 5 / 100, true, CURVE_LAST_PARAMS),
            u64::MAX as u128,
            CURVE_LAST_PARAMS,
        )
        .unwrap();
        assert_eq!(amount, 49999952566199);
    }
}
