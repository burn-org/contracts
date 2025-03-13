import { expect } from "chai";
import {
  compute_buy_token_exact_in,
  compute_swap,
  curve_points,
  CurvePoint,
} from "./swap_math";
import { MAX_TOKEN_SUPPLY } from "./token_math";
import { web3 } from "@coral-xyz/anchor";
import Decimal from "decimal.js";

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

describe("swap-math", () => {
  describe("buy token", () => {
    const table = [
      BigInt(1),
      BigInt(3),
      BigInt(10),
      BigInt(33),
      BigInt(100),
      BigInt(333),
      BigInt(1000),
      BigInt(3333),
      BigInt(10000),
      BigInt(33333),
      BigInt(100000),
      BigInt(333333),
      BigInt(1000000),
      BigInt(3333333),
      BigInt(10000000),
      BigInt(33333333),
      BigInt(100000000),
      BigInt(333333333),
      BigInt(1000000000),
      BigInt(3333333333),
      BigInt(10000000000),
      BigInt(33333333333),
      BigInt(100000000000),
      BigInt(333333333333),
      BigInt(1000000000000),
      BigInt(3333333333333),
      BigInt(10000000000000),
      BigInt(33333333333333),
      BigInt(100000000000000),
      BigInt(333333333333333),
      BigInt(1000000000000000 - 1),
    ];
    table.forEach((amount) => {
      it(`buy amount is ${amount.toString()}`, () => {
        const pay = compute_swap(amount, MAX_TOKEN_SUPPLY, true);
        const amount2 = compute_buy_token_exact_in(pay, MAX_TOKEN_SUPPLY);
        expect(amount2 <= amount).to.be.true;
      });
    });
  });

  const sol_price = new Decimal("200");
  describe("#curve_points", () => {
    it("already sold is zero", () => {
      let points = curve_points(MAX_TOKEN_SUPPLY);
      expect(points.length).to.eq(1000);
      expect(points[0].current).to.true;

      // to_echarts_option(points, sol_price);
    });

    it("already sold is 1%", () => {
      let points = curve_points(
        MAX_TOKEN_SUPPLY - (MAX_TOKEN_SUPPLY * BigInt(1)) / BigInt(100)
      );
      expect(points.length).to.eq(1000);
      expect(points.findIndex((point) => point.current)).to.gt(-1);

      // to_echarts_option(points, sol_price);
    });

    it("already sold is 30%", () => {
      let points = curve_points(
        MAX_TOKEN_SUPPLY - (MAX_TOKEN_SUPPLY * BigInt(30)) / BigInt(100),
        1000
      );
      expect(points.length).to.eq(1000);
      expect(points.findIndex((point) => point.current)).to.gt(-1);

      // to_echarts_option(points, sol_price);
    });

    it("already sold is 50%", () => {
      let points = curve_points(
        MAX_TOKEN_SUPPLY - (MAX_TOKEN_SUPPLY * BigInt(50)) / BigInt(100)
      );
      expect(points.length).to.eq(1000);
      expect(points.findIndex((point) => point.current)).to.gt(-1);

      // to_echarts_option(points, sol_price);
    });

    it("already sold is 70%", () => {
      let points = curve_points(
        MAX_TOKEN_SUPPLY - (MAX_TOKEN_SUPPLY * BigInt(70)) / BigInt(100)
      );
      expect(points.length).to.eq(1000);
      expect(points.findIndex((point) => point.current)).to.gt(-1);

      // to_echarts_option(points, sol_price);
    });

    it("already sold is 90%", () => {
      let points = curve_points(
        MAX_TOKEN_SUPPLY - (MAX_TOKEN_SUPPLY * BigInt(90)) / BigInt(100),
        1000
      );
      expect(points.length).to.eq(1000);
      expect(points.findIndex((point) => point.current)).to.gt(-1);

      // to_echarts_option(points, sol_price);
    });
  });
});

function to_echarts_option(points: Array<CurvePoint>, sol_price: Decimal) {
  console.log(`
option = {
  tooltip: {
    trigger: 'item',
    axisPointer: { type: 'cross' }
  },
  xAxis: {
    type: 'category',
    data: [
      ${points
        .map(
          (point) =>
            new Decimal(point.buy_amount.toString())
              .div(new Decimal(1e6))
              .div(new Decimal(10e6)) // buy_amount / 10e8 * 1e2
        )
        .join(", ")}
    ],
    axisLabel: {
      rotate: 90,
      width: 50,
      ellipsis: '...',
      overflow: 'truncate'
    }    
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [
      ${points
        .map((point) => point.market_cap.mul(sol_price).toFixed(2))
        .join(", ")}
      ],
      type: 'line',
      smooth: true
    }
  ]
};    
    `);
}
