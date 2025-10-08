const multiTokenVaultAbi = require('./multiTokenVaultAbi.json');
const erc165Abi = require('./erc165Abi.json');
const subConsolAbi = require('./subConsolAbi.json');
const forfeitedAssetsPoolAbi = require('./forfeitedAssetsPoolAbi.json');
const { sumTokens2 } = require('../helper/unwrapLPs')

const config = {
  hyperliquid: {
    consol: "0xc017d8634D444D5CBB31A2613FbE127E18df17AE",
    fromBlock: 15861637
  },
}

const ISubConsolInterfaceId = '0x80294d93';
const IForfeitedAssetsPoolInterfaceId = '0xd955ed1a';
const IUSDXInterfaceId = '0x339d3cfe';

const INPUT_TYPE = 'SUB_CONSOL' | 'FORFEITED_ASSETS_POOL' | 'USDX';

async function getConsolInputType(api, address) {
  // Get the type for the consol input
  const [subConsolSupportsInterface, forfeitedAssetsPoolSupportsInterface, usdxSupportsInterface] = await api.multiCall({
    abi: erc165Abi.supportsInterface,
    calls: [
      { target: address, params: ISubConsolInterfaceId },
      { target: address, params: IForfeitedAssetsPoolInterfaceId },
      { target: address, params: IUSDXInterfaceId },
    ],
    permitFailure: false,
  });
  if (subConsolSupportsInterface) {
    return 'SUB_CONSOL';
  }
  if (forfeitedAssetsPoolSupportsInterface) {
    return 'FORFEITED_ASSETS_POOL';
  }
  if (usdxSupportsInterface) {
    return 'USDX';
  }
}

async function getAllSupportedTokens(api, multiTokenVault) {
  const tokens = await api.call({
    abi: multiTokenVaultAbi.getSupportedTokens,
    target: multiTokenVault,
  });
  return tokens;
}

async function getCollateral(api, subConsol) {
  const collateral = await api.call({
    abi: subConsolAbi.collateral,
    target: subConsol,
  });
  return collateral;
}

async function getAllForfeitedAssets(api, forfeitedAssetsPool) {
  const totalAssets = await api.call({
    abi: forfeitedAssetsPoolAbi.totalAssets,
    target: forfeitedAssetsPool,
  });
  return await api.multiCall({
    abi: forfeitedAssetsPoolAbi.getAsset,
    calls: Array.from({ length: totalAssets }, (_, i) => ({ target: forfeitedAssetsPool, params: i })),
    permitFailure: false,
  })
}

Object.keys(config).forEach(chain => {
  const { consol } = config[chain];
  module.exports[chain] = {
    tvl: async (api) => {

      // Get all of the Consol inputs
      const consolSupportedTokens = await getAllSupportedTokens(api, consol);
      // Get the corresponding types for each Consol input
      const consolInputTypes = await Promise.all(consolSupportedTokens.map(token => getConsolInputType(api, token)));

      // Fetch all of the underlying assets for each Consol input
      const tokens = await Promise.all(consolSupportedTokens.map((consolInput, idx) => {
        // For USDX, fetch all of the supported tokens out of USDX
        if (consolInputTypes[idx] === 'USDX') {
          return getAllSupportedTokens(api, consolInput);
        }
        // For SUB_CONSOL, fetch the corresponding collateral address
        if (consolInputTypes[idx] === 'SUB_CONSOL') {
          return getCollateral(api, consolInput).then(collateral => [collateral]);
        }
        // For FORFEITED_ASSETS_POOL, we all of the assets inside that are eligible
        if (consolInputTypes[idx] === 'FORFEITED_ASSETS_POOL') {
          return getAllForfeitedAssets(api, consolInput).then(assets => assets.map(asset => [asset]));
        }
      })).then(tokens => [...new Set(tokens.flat(1))]);

      // Consol TVL = Sum(Supported token TVL)
      const owners = consolSupportedTokens;
      return sumTokens2({ api, tokens, owners })
    }
  }
})
