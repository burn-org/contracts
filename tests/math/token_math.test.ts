import { expect } from "chai";
import { compute_swap } from "./swap_math";
import {
  calculate_curve,
  calculate_price,
  CURVE_1_PARAMS,
  CURVE_2_PARAMS,
  CURVE_3_PARAMS,
  CURVES,
  find_root,
  MAX_TOKEN_SUPPLY,
  search_curve,
} from "./token_math";

describe("token-math", () => {
  describe("#calculate_curve", () => {
    it("curve 1 and percent is max token supply", () => {
      expect(calculate_curve(MAX_TOKEN_SUPPLY, true, CURVE_1_PARAMS)).to.eq(
        BigInt(0)
      );
      expect(calculate_curve(MAX_TOKEN_SUPPLY, false, CURVE_1_PARAMS)).to.eq(
        BigInt(0)
      );
    });
    it("curve 1 and percent is 99 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(99)) / BigInt(100),
          true,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(287142489 + 1));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(99)) / BigInt(100),
          false,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(287142489));
    });
    it("curve 1 and percent is 98 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(98)) / BigInt(100),
          true,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(589160493 + 1));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(98)) / BigInt(100),
          false,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(589160493));
    });
    it("curve 1 and percent is 97 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(97)) / BigInt(100),
          true,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(906988423 + 1));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(97)) / BigInt(100),
          false,
          CURVE_1_PARAMS
        )
      ).to.eq(BigInt(906988423));
    });
    it("curve 2 and percent is 79 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(79)) / BigInt(100),
          true,
          CURVE_2_PARAMS
        )
      ).to.eq(BigInt(10960628930 + 1));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(79)) / BigInt(100),
          false,
          CURVE_2_PARAMS
        )
      ).to.eq(BigInt(10960628930));
    });
    it("curve 2 and percent is 63 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(63)) / BigInt(100),
          true,
          CURVE_2_PARAMS
        )
      ).to.eq(BigInt(31024794697 + 1));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(63)) / BigInt(100),
          false,
          CURVE_2_PARAMS
        )
      ).to.eq(BigInt(31024794697));
    });
    it("curve 3 and percent is 4 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(4)) / BigInt(100),
          true,
          CURVE_3_PARAMS
        )
      ).to.eq(BigInt(13100910156250));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(4)) / BigInt(100),
          false,
          CURVE_3_PARAMS
        )
      ).to.eq(BigInt(13100910156250));
    });
    it("curve 3 and percent is 1 percent of max token supply", () => {
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(1)) / BigInt(100),
          true,
          CURVE_3_PARAMS
        )
      ).to.eq(BigInt(78725910156250));
      expect(
        calculate_curve(
          (MAX_TOKEN_SUPPLY * BigInt(1)) / BigInt(100),
          false,
          CURVE_3_PARAMS
        )
      ).to.eq(BigInt(78725910156250));
    });
  });
  describe("#find_root", () => {
    it("find root and native amount is 0", () => {
      for (let i = 0; i < CURVES.length - 1; i++) {
        let curve = CURVES[i];
        let native_amount = calculate_curve(
          CURVES[i + 1].token_supply_at_boundary,
          true,
          curve
        );
        let root = find_root(
          curve.token_supply_at_boundary + BigInt(1),
          native_amount,
          BigInt(0),
          curve
        );
        expect(root).to.eq(BigInt(0));
      }
    });
  });
  describe("#calculate_price", () => {
    it("should success", () => {
      {
        let amount = BigInt(0) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000000028000000");
      }
      {
        let amount = BigInt(1000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000000029442999");
      }
      {
        let amount = BigInt(2000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000000030976165");
      }
      {
        let amount = BigInt(1_0000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000000047418245");
      }
      {
        let amount = BigInt(4_0000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000000202546296");
      }
      {
        let amount = BigInt(7_0000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000001620370370");
      }
      {
        let amount = BigInt(9_5000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.000350000000000");
      }
      {
        let amount = BigInt(9_9000e4) * BigInt(1e6);
        let target_token_supply = MAX_TOKEN_SUPPLY - amount;
        let price = calculate_price(
          target_token_supply,
          compute_swap(amount, MAX_TOKEN_SUPPLY, true),
          search_curve(target_token_supply)
        );
        expect(price.toFixed(15)).to.eq("0.008750000000000");
      }
    });
  });
});
