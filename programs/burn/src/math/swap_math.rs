use crate::{constants::MAX_TOKEN_SUPPLY, errors::Error as MyError};
use anchor_lang::error::Error;

use super::{math::ceil_div, token_math};

/// Computes the native amount to be paid when buying or received when selling.
///
/// # Parameters
/// - `amount`: The amount of token to be swapped.
/// - `remaining_supply`: The remaining token supply on the bounding curve.
/// - `buy`: If true, buying, if false, selling.
///
/// <div class="warning">
///
/// The caller MUST ensure that the `amount` does not exceed `remaining_supply` when buying
/// and `constants::MAX_TOKEN_SUPPLY - remaining_supply` when selling.
///
/// </div>
pub fn compute_swap(amount: u64, remaining_token_supply: u64, buy: bool) -> Result<u64, Error> {
    let target_token_supply = if buy {
        remaining_token_supply - amount
    } else {
        remaining_token_supply + amount
    };

    let mut remaining_token_supply = remaining_token_supply;
    let mut native_amount: u128 = 0;
    if buy {
        let mut start_native_amount: u128 = 0;
        let mut start_native_amount_not_set: bool = true;
        let mut end_native_amount: u128 = 0;
        for curve in token_math::CURVES.iter() {
            if remaining_token_supply > curve.token_supply_at_boundary {
                if start_native_amount_not_set {
                    start_native_amount_not_set = false;
                    start_native_amount = token_math::calculate_curve(remaining_token_supply, false, curve);
                }

                if target_token_supply >= curve.token_supply_at_boundary {
                    end_native_amount = token_math::calculate_curve(target_token_supply, true, curve);
                    break;
                } else {
                    // reach the curve boundary
                    remaining_token_supply = curve.token_supply_at_boundary;
                }
            }
        }
        native_amount = end_native_amount - start_native_amount;
    } else {
        let mut i: usize = token_math::CURVES.len() - 1;
        let mut end_native_amount: u128 = 0;
        let start_native_amount: u128;
        loop {
            let curve = token_math::CURVES[i];
            let token_supply_at_start_boundary: u64;
            if i == 0 {
                token_supply_at_start_boundary = MAX_TOKEN_SUPPLY;
            } else {
                token_supply_at_start_boundary = token_math::CURVES[i - 1].token_supply_at_boundary;
            }

            if remaining_token_supply < token_supply_at_start_boundary {
                if end_native_amount == 0 {
                    end_native_amount = token_math::calculate_curve(remaining_token_supply, false, curve);
                }

                if target_token_supply <= token_supply_at_start_boundary {
                    start_native_amount = token_math::calculate_curve(target_token_supply, true, curve);
                    break;
                } else {
                    // go back the previous curve boundary
                    remaining_token_supply = token_supply_at_start_boundary;
                }
            }

            debug_assert!(i >= 1);
            i -= 1;
        }
        if end_native_amount > start_native_amount {
            native_amount = end_native_amount - start_native_amount;
        }
    }

    if native_amount > u64::MAX as u128 {
        return Err(MyError::TooMuchNativeTokenRequired.into());
    }

    Ok(native_amount as u64)
}

/// Computes the amount of token to be bought with the given pay amount.
pub fn compute_buy_token_exact_in(pay_amount: u64, remaining_token_supply: u64) -> Result<u64, Error> {
    let mut start_native_amount: u128 = 0;
    let mut start_native_amount_not_set: bool = true;
    let mut pay_amount = pay_amount as u128;
    let mut remaining_token_supply = remaining_token_supply;
    let mut buy_amount = 0;
    for curve in token_math::CURVES.iter() {
        if remaining_token_supply > curve.token_supply_at_boundary {
            if start_native_amount_not_set {
                start_native_amount_not_set = false;
                start_native_amount = token_math::calculate_curve(remaining_token_supply, false, curve);
            }

            let remaining_native_amount: u128 = curve.native_amount_at_boundary as u128 - start_native_amount;
            if pay_amount < remaining_native_amount
                || curve.k_with_multiplier_sol == token_math::CURVE_LAST_PARAMS.k_with_multiplier_sol
            {
                // still in the curve
                start_native_amount = token_math::calculate_curve(remaining_token_supply, true, curve); // use rounding up to ensure that the number of tokens bought is less
                buy_amount += token_math::find_root(remaining_token_supply, start_native_amount, pay_amount, curve)?;
                break;
            } else if pay_amount == remaining_native_amount {
                // reach the curve boundary and the remaining native amount is exactly the same as the boundary
                buy_amount += remaining_token_supply - curve.token_supply_at_boundary;
                break;
            } else {
                // reach the curve boundary
                buy_amount += remaining_token_supply - curve.token_supply_at_boundary;
                remaining_token_supply = curve.token_supply_at_boundary;
                pay_amount -= remaining_native_amount;
                start_native_amount = curve.native_amount_at_boundary as u128;
            }
        }
    }
    Ok(buy_amount)
}

/// Splits an amount into buy amount and fee amount.
pub fn split_pay_amount(max_pay_amount: u64) -> Result<(u64, u64), Error> {
    // x * (1 + fee) = max_pay_amount
    // x = max_pay_amount / (1 + fee)
    // x = max_pay_amount / (1 + 1 / 100)
    // x = max_pay_amount * 100 / 101
    let pay_amount = ceil_div(max_pay_amount as u128 * 100, 101) as u64;
    let fee_amount = max_pay_amount - pay_amount;
    Ok((pay_amount, fee_amount))
}

/// Computes the fee amount.
pub fn compute_fee(amount: u64) -> u64 {
    ceil_div(amount as u128, 100) as u64 // 1%
}
#[cfg(test)]
mod tests {
    use anchor_lang::solana_program::native_token::LAMPORTS_PER_SOL;

    use super::*;
    use crate::constants::MAX_TOKEN_SUPPLY;

    #[test]
    #[should_panic(expected = "TooMuchNativeTokenRequired")]
    fn test_compute_swap_too_much_native_token_required() {
        compute_swap(1, 2, true).unwrap();
    }

    #[test]
    fn test_compute_swap_with_buy_and_curve_1() {
        let y = compute_swap(1, MAX_TOKEN_SUPPLY, true).unwrap();
        assert_eq!(y, 1);

        let y = compute_swap(1, token_math::CURVE_1_PARAMS.token_supply_at_boundary + 1, true).unwrap();
        assert_eq!(y, 1);
        let y = compute_swap(1, token_math::CURVE_1_PARAMS.token_supply_at_boundary, false).unwrap();
        assert_eq!(y, 0);

        let y = compute_swap(MAX_TOKEN_SUPPLY * 20 / 100, MAX_TOKEN_SUPPLY, true).unwrap();
        assert_eq!(y, token_math::CURVE_1_PARAMS.native_amount_at_boundary);

        let y = compute_swap(
            MAX_TOKEN_SUPPLY * 20 / 100,
            token_math::CURVE_1_PARAMS.token_supply_at_boundary,
            false,
        )
        .unwrap();
        assert_eq!(y, token_math::CURVE_1_PARAMS.native_amount_at_boundary);
    }

    #[test]
    fn test_compute_swap_with_buy_and_curve_2() {
        let y = compute_swap(1, token_math::CURVE_2_PARAMS.token_supply_at_boundary, true).unwrap();
        assert_eq!(y, 0 + 1);

        let y = compute_swap(1, token_math::CURVE_2_PARAMS.token_supply_at_boundary - 1, false).unwrap();
        assert_eq!(y, 0);

        let y = compute_swap(
            token_math::CURVE_1_PARAMS.token_supply_at_boundary - token_math::CURVE_2_PARAMS.token_supply_at_boundary,
            token_math::CURVE_1_PARAMS.token_supply_at_boundary,
            true,
        )
        .unwrap();
        assert_eq!(
            y,
            token_math::CURVE_2_PARAMS.native_amount_at_boundary - token_math::CURVE_1_PARAMS.native_amount_at_boundary
        );

        let y = compute_swap(
            token_math::CURVE_1_PARAMS.token_supply_at_boundary - token_math::CURVE_2_PARAMS.token_supply_at_boundary,
            token_math::CURVE_2_PARAMS.token_supply_at_boundary,
            false,
        )
        .unwrap();
        assert_eq!(
            y,
            token_math::CURVE_2_PARAMS.native_amount_at_boundary - token_math::CURVE_1_PARAMS.native_amount_at_boundary
        );
    }

    #[test]
    fn test_compute_swap_with_buy_and_curve_3() {
        let y = compute_swap(1, token_math::CURVE_2_PARAMS.token_supply_at_boundary, true).unwrap();
        assert_eq!(y, 0 + 1);
        let y = compute_swap(1, token_math::CURVE_2_PARAMS.token_supply_at_boundary - 1, false).unwrap();
        assert_eq!(y, 0);

        let y = compute_swap(1, MAX_TOKEN_SUPPLY * 5 / 100, true).unwrap();
        assert_eq!(y, 0 + 1);
        let y = compute_swap(1, MAX_TOKEN_SUPPLY * 5 / 100 - 1, false).unwrap();
        assert_eq!(y, 0);

        let y = compute_swap(1, MAX_TOKEN_SUPPLY * 3 / 100, true).unwrap();
        assert_eq!(y, 1 + 1);
        let y = compute_swap(1, MAX_TOKEN_SUPPLY * 3 / 100 - 1, false).unwrap();
        assert_eq!(y, 0);
    }

    #[test]
    fn test_compute_swap_with_buy_and_both_curve() {
        let pay = compute_swap(1, MAX_TOKEN_SUPPLY, true).unwrap();
        assert_eq!(pay, 0 + 1);
        let receive = compute_swap(1, MAX_TOKEN_SUPPLY - 1, false).unwrap();
        assert_eq!(receive, 0);

        let pay = compute_swap(1, token_math::CURVE_1_PARAMS.token_supply_at_boundary + 1, true).unwrap();
        assert_eq!(pay, 1);
        let receive = compute_swap(1, token_math::CURVE_1_PARAMS.token_supply_at_boundary, false).unwrap();
        assert_eq!(receive, 0);

        let pay = compute_swap(2, token_math::CURVE_1_PARAMS.token_supply_at_boundary + 1, true).unwrap();
        assert_eq!(pay, 1 + 1);
        let receive = compute_swap(2, token_math::CURVE_1_PARAMS.token_supply_at_boundary - 1, false).unwrap();
        assert_eq!(receive, 0);

        let pay = compute_swap(MAX_TOKEN_SUPPLY * 10 / 100 + 1, MAX_TOKEN_SUPPLY, true).unwrap();
        assert_eq!(pay, 3669105319 + 1);
        let receive = compute_swap(
            MAX_TOKEN_SUPPLY * 10 / 100 + 1,
            MAX_TOKEN_SUPPLY - 1 - MAX_TOKEN_SUPPLY * 10 / 100,
            false,
        )
        .unwrap();
        assert_eq!(receive, 3669105319);

        let pay = compute_swap(MAX_TOKEN_SUPPLY * 10 / 100, MAX_TOKEN_SUPPLY - 1, true).unwrap();
        assert_eq!(pay, 3669105319 + 1);
        let receive = compute_swap(
            MAX_TOKEN_SUPPLY * 10 / 100,
            MAX_TOKEN_SUPPLY - 1 - MAX_TOKEN_SUPPLY * 10 / 100,
            false,
        )
        .unwrap();
        assert_eq!(receive, 3669105318);

        let pay = compute_swap(MAX_TOKEN_SUPPLY * 95 / 100, MAX_TOKEN_SUPPLY, true).unwrap();
        assert_eq!(pay, 8725910156250);
        let receive = compute_swap(MAX_TOKEN_SUPPLY * 95 / 100, MAX_TOKEN_SUPPLY * 5 / 100, false).unwrap();
        assert_eq!(receive, 8725910156250);

        let pay = compute_swap(MAX_TOKEN_SUPPLY * 95 / 100 + 1, MAX_TOKEN_SUPPLY - 1, true).unwrap();
        assert_eq!(pay, 8725910156250 + 1);
        let receive = compute_swap(MAX_TOKEN_SUPPLY * 95 / 100 + 1, MAX_TOKEN_SUPPLY * 5 / 100 - 2, false).unwrap();
        assert_eq!(receive, 8725910156249);
    }

    #[test]
    fn test_compute_swap_with_buy_and_sell_on_curve_1() {
        let sell_y = compute_swap(MAX_TOKEN_SUPPLY * 1 / 10, MAX_TOKEN_SUPPLY * 7 / 10, false).unwrap();
        let buy_y = compute_swap(MAX_TOKEN_SUPPLY * 1 / 10, MAX_TOKEN_SUPPLY * 8 / 10, true).unwrap();
        assert!(buy_y > sell_y);
    }

    #[test]
    fn test_compute_swap_with_buy_and_sell_on_curve_2() {
        let sell_y = compute_swap(MAX_TOKEN_SUPPLY * 1 / 10, MAX_TOKEN_SUPPLY * 2 / 10, false).unwrap();
        let buy_y = compute_swap(MAX_TOKEN_SUPPLY * 1 / 10, MAX_TOKEN_SUPPLY * 3 / 10, true).unwrap();
        assert!(buy_y > sell_y);
    }

    #[test]
    fn test_compute_swap_with_buy_and_sell_on_both_curve() {
        let sell_y = compute_swap(MAX_TOKEN_SUPPLY * 2 / 10, MAX_TOKEN_SUPPLY * 4 / 10, false).unwrap();
        let buy_y = compute_swap(MAX_TOKEN_SUPPLY * 2 / 10, MAX_TOKEN_SUPPLY * 6 / 10, true).unwrap();
        assert!(buy_y > sell_y);
    }

    #[derive(Debug)]
    struct TestCase {
        remaining_supply: u64,
        actual_pay: u64,
    }

    #[test]
    fn test_compute_buy_token_exact_in() {
        let cases = [
            TestCase {
                remaining_supply: 10e8 as u64 * 1e6 as u64,
                actual_pay: 32767 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 10e8 as u64 * 1e6 as u64 - 1,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 999999999 * 1e6 as u64,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 888888888 * 1e6 as u64,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 777777777 * 1e6 as u64,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 666666666 * 1e6 as u64,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 555555555 * 1e6 as u64,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2 + 1,
                actual_pay: 34444 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2 - 1,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 444444444 * 1e6 as u64,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 333333333 * 1e6 as u64,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 222222222 * 1e6 as u64,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY * 2 / 10 + 1,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2 - 1,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 444444444 * 1e6 as u64,
                actual_pay: 5333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 333333333 * 1e6 as u64,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 222222222 * 1e6 as u64,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY * 2 / 10 + 1,
                actual_pay: 35333333 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 10e8 as u64 * 1e6 as u64,
                actual_pay: 32767 * LAMPORTS_PER_SOL,
            },
            TestCase {
                remaining_supply: 10e8 as u64 * 1e6 as u64 - 1,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 999999999 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 888888888 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 777777777 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 666666666 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 555555555 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2 + 1,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY / 2 - 1,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 444444444 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 333333333 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: 222222222 * 1e6 as u64,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY * 2 / 10 + 1,
                actual_pay: 33333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY * 2 / 10 + 1,
                actual_pay: 333333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY * 1 / 10 + 1,
                actual_pay: 3333333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY,
                actual_pay: 3333333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY - 1,
                actual_pay: 3333333333 * 333333333,
            },
            TestCase {
                remaining_supply: MAX_TOKEN_SUPPLY - 11111111111,
                actual_pay: 3333333333 * 333333333,
            },
            TestCase {
                remaining_supply: token_math::CURVE_1_PARAMS.token_supply_at_boundary - 11111111111,
                actual_pay: 3333333333 * 333333333,
            },
            TestCase {
                remaining_supply: token_math::CURVE_2_PARAMS.token_supply_at_boundary - 11111111111,
                actual_pay: 3333333333 * 333333333,
            },
        ];
        for case in cases.iter() {
            let buy_amount = compute_buy_token_exact_in(case.actual_pay, case.remaining_supply).unwrap();
            let expect_pay = compute_swap(buy_amount, case.remaining_supply, true).unwrap();
            assert!(expect_pay <= case.actual_pay);
        }
    }

    #[test]
    fn test_compute_buy_token_exact_in_with_u64_max() {
        let buy_amount = compute_buy_token_exact_in(u64::MAX, MAX_TOKEN_SUPPLY).unwrap();
        println!("buy_amount: {}", buy_amount);
    }

    #[test]
    fn test_compute_buy_token_exact_in_2() {
        let buy_amount = compute_buy_token_exact_in(100000000, 997000291850416).unwrap();
        println!("buy_amount: {}", buy_amount);
        let pay = compute_swap(buy_amount, 997000291850416, true).unwrap();
        println!("pay: {}", pay);
    }

    #[test]
    fn test_compute_fee() {
        assert_eq!(compute_fee(10000), 100);
        assert_eq!(compute_fee(33), 1);
        assert_eq!(compute_fee(333), 4);
    }

    #[test]
    fn test_split_pay_amount() {
        let (pay, fee) = split_pay_amount(10000).unwrap();
        assert_eq!(pay, 9901);
        assert_eq!(fee, 99);

        let (pay, fee) = split_pay_amount(33).unwrap();
        assert_eq!(pay, 33);
        assert_eq!(fee, 0);

        let (pay, fee) = split_pay_amount(333).unwrap();
        assert_eq!(pay, 330);
        assert_eq!(fee, 3);
    }
}
