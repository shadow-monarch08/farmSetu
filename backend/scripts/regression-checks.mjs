function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function algoToMicro(amountAlgo) {
  return Math.round(amountAlgo * 1_000_000);
}

function microToAlgo(amountMicro) {
  return amountMicro / 1_000_000;
}

function settlementAmount(agreedAlgo, currentAlgo, quantity) {
  return Math.abs(currentAlgo - agreedAlgo) * quantity;
}

function run() {
  assert(algoToMicro(1) === 1_000_000, "1 ALGO should be 1,000,000 microALGO");
  assert(algoToMicro(10.5) === 10_500_000, "10.5 ALGO conversion failed");
  assert(microToAlgo(2_500_000) === 2.5, "microALGO to ALGO conversion failed");

  assert(settlementAmount(10, 12, 100) === 200, "Settlement for price increase failed");
  assert(settlementAmount(10, 8, 100) === 200, "Settlement for price decrease failed");
  assert(settlementAmount(10, 10, 100) === 0, "Settlement for unchanged price failed");

  console.log("Regression checks passed.");
}

run();
