import { CallOverrides } from "@ethersproject/contracts";

import { CachedFetcher } from "../cache";
import { ChainId } from "../chain";
import { ServiceInterface } from "../common";
import {
  Address,
  Balance,
  CyTokenUserMetadata,
  ERC20,
  IronBankMarket,
  IronBankMarketDynamic,
  IronBankMarketStatic,
  IronBankUserSummary,
  Position,
  SdkError,
  Token,
  TokenDataSource
} from "../types";

export class IronBankInterface<T extends ChainId> extends ServiceInterface<T> {
  private cachedFetcherGet = new CachedFetcher<IronBankMarket[]>("ironbank/get", this.ctx, this.chainId);
  private cachedFetcherGetDynamic = new CachedFetcher<IronBankMarketDynamic[]>(
    "ironbank/getDynamic",
    this.ctx,
    this.chainId
  );
  private cachedFetcherTokens = new CachedFetcher<Token[]>("ironbank/tokens", this.ctx, this.chainId);

  /**
   * Get all IronBank markets.
   * @param addresses filter, if not provided all positions are returned
   * @param overrides
   * @returns
   */
  async get(addresses?: Address[], overrides?: CallOverrides): Promise<IronBankMarket[]> {
    const cached = await this.cachedFetcherGet.fetch();
    if (cached) {
      if (addresses) {
        return cached.filter(market => addresses.includes(market.address));
      } else {
        return cached;
      }
    }

    const assetsStatic = await this.yearn.services.lens.adapters.ironBank.assetsStatic(addresses, overrides);
    const assetsDynamic = await this.yearn.services.lens.adapters.ironBank.assetsDynamic(addresses, overrides);
    const assets = new Array<IronBankMarket>();
    for (const asset of assetsStatic) {
      const dynamic = assetsDynamic.find(({ address }) => asset.address === address);
      if (!dynamic) {
        throw new SdkError(`Dynamic asset does not exist for ${asset.address}`);
      }
      assets.push({ ...asset, ...dynamic });
    }
    return assets;
  }

  /**
   * Get static part of IronBank markets.
   * @param addresses filter, if not provided all positions are returned
   * @param overrides
   * @returns
   */
  async getStatic(addresses?: Address[], overrides?: CallOverrides): Promise<IronBankMarketStatic[]> {
    return await this.yearn.services.lens.adapters.ironBank.assetsStatic(addresses, overrides);
  }

  /**
   * Get dynamic part of IronBank markets.
   * @param addresses filter, if not provided all positions are returned
   * @param overrides
   * @returns
   */
  async getDynamic(addresses?: Address[], overrides?: CallOverrides): Promise<IronBankMarketDynamic[]> {
    const cached = await this.cachedFetcherGetDynamic.fetch();
    if (cached) {
      if (addresses) {
        return cached.filter(market => addresses.includes(market.address));
      } else {
        return cached;
      }
    }

    return await this.yearn.services.lens.adapters.ironBank.assetsDynamic(addresses, overrides);
  }

  /**
   * Get IronBank market positions for a particular address.
   * @param address
   * @param addresses filter, if not provided all positions are returned
   * @param overrides
   * @returns
   */
  async positionsOf(address: Address, addresses?: Address[], overrides?: CallOverrides): Promise<Position[]> {
    return this.yearn.services.lens.adapters.ironBank.positionsOf(address, addresses, overrides);
  }

  /**
   * Get the IronBank User Summary for a particular address.
   * @param address
   * @param overrides
   * @returns
   */
  async summaryOf(address: Address, overrides?: CallOverrides): Promise<IronBankUserSummary> {
    return this.yearn.services.lens.adapters.ironBank.generalPositionOf(address, overrides);
  }

  /**
   * Get the IronBank User Metadata for a particular address.
   * @param address
   * @param addresses
   * @param overrides
   * @returns
   */
  async metadataOf(address: Address, addresses?: Address[], overrides?: CallOverrides): Promise<CyTokenUserMetadata[]> {
    return this.yearn.services.lens.adapters.ironBank.assetsUserMetadata(address, addresses, overrides);
  }

  /**
   * Get all IronBank market's underlying token balances for a particular
   * address.
   * @param address
   * @param overrides
   * @returns
   */
  async balances(address: Address, overrides?: CallOverrides): Promise<Balance[]> {
    const tokens = await this.tokens();
    const balances = await this.yearn.services.helper.tokenBalances(
      address,
      tokens.map(token => token.address),
      overrides
    );
    return balances.map(balance => {
      const token = tokens.find(token => token.address === balance.address);
      if (!token) {
        throw new SdkError(`Token does not exist for Balance(${balance.address})`);
      }
      return {
        ...balance,
        token
      };
    });
  }

  /**
   * Get all IronBank market's underlying tokens.
   * @param overrides
   * @returns
   */
  async tokens(overrides?: CallOverrides): Promise<Token[]> {
    const cached = await this.cachedFetcherTokens.fetch();
    if (cached) {
      return cached;
    }

    const tokenAddresses = await this.yearn.services.lens.adapters.ironBank.tokens(overrides);

    const icons = this.yearn.services.asset.icon(tokenAddresses);

    const erc20Tokens = await this.yearn.services.helper.tokens(tokenAddresses, overrides);
    const erc20ToToken: (erc20Token: ERC20) => Promise<Token> = async (erc20Token: ERC20) => ({
      ...erc20Token,
      icon: icons[erc20Token.address],
      dataSource: "ironBank" as TokenDataSource,
      supported: {
        ironBank: true
      },
      priceUsdc: await this.yearn.services.oracle.getPriceUsdc(erc20Token.address, overrides)
    });

    return Promise.all(erc20Tokens.map(erc20ToToken));
  }
}
