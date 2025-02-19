import { MaxUint256 } from "@ethersproject/constants";
import { Contract } from "@ethersproject/contracts";

import { Address, Asset, ChainId, SdkError, Token, TokenInterface, TokenMetadata } from "..";
import { CachedFetcher } from "../cache";
import { Context } from "../context";
import { EthAddress } from "../helpers";
import { PartnerService } from "../services/partner";
import { createMockAssetStaticVaultV2, createMockBalance, createMockToken } from "../test-utils/factories";
import { Yearn } from "../yearn";

const getPriceUsdcMock = jest.fn();
const getPriceFromRouterMock = jest.fn(() => Promise.resolve(1));
const zapperBalancesMock = jest.fn();
const zapperGasMock = jest.fn();
const zapperSupportedTokensMock = jest.fn();
const zapperZapInApprovalStateMock = jest.fn();
const zapperZapInApprovalTransactionMock = jest.fn();
const zapperZapOutApprovalStateMock = jest.fn();
const zapperZapOutApprovalTransactionMock = jest.fn();
const assetIconMock = jest.fn();
const assetReadyThenMock = jest.fn();
const metaTokensMock = jest.fn();
const vaultsBalancesMock = jest.fn();
const vaultsTokensMock = jest.fn();
const ironBankBalancesMock = jest.fn();
const ironBankTokensMock = jest.fn();
const sendTransactionMock = jest.fn();
const approveMock = jest.fn().mockResolvedValue(true);
const allowanceMock = jest.fn().mockResolvedValue("0");
const partnerIsAllowedMock = jest.fn().mockReturnValue(true);

jest.mock("@ethersproject/contracts", () => ({
  Contract: jest.fn().mockImplementation(() => ({
    populateTransaction: {
      approve: approveMock
    },
    allowance: allowanceMock
  }))
}));

jest.mock("../services/partner", () => ({
  PartnerService: jest.fn().mockImplementation(() => ({
    isAllowed: partnerIsAllowedMock,
    partnerId: "0x000partner",
    address: "0x0001partner"
  }))
}));

jest.mock("../yearn", () => ({
  Yearn: jest.fn().mockImplementation(() => ({
    services: {
      asset: {
        ready: { then: assetReadyThenMock },
        icon: assetIconMock
      },
      meta: {
        tokens: metaTokensMock
      },
      oracle: {
        getPriceFromRouter: getPriceFromRouterMock,
        getPriceUsdc: getPriceUsdcMock
      },
      zapper: {
        balances: zapperBalancesMock,
        gas: zapperGasMock,
        supportedTokens: zapperSupportedTokensMock,
        zapInApprovalState: zapperZapInApprovalStateMock,
        zapInApprovalTransaction: zapperZapInApprovalTransactionMock,
        zapOutApprovalState: zapperZapOutApprovalStateMock,
        zapOutApprovalTransaction: zapperZapOutApprovalTransactionMock
      },
      transaction: {
        sendTransaction: sendTransactionMock
      }
    },
    ironBank: { balances: ironBankBalancesMock, tokens: ironBankTokensMock },
    vaults: {
      balances: vaultsBalancesMock,
      tokens: vaultsTokensMock
    }
  }))
}));

jest.mock("../context", () => ({
  Context: jest.fn().mockImplementation(() => ({
    provider: {
      write: {
        getSigner: jest.fn().mockImplementation(() => ({
          sendTransaction: jest.fn().mockResolvedValue("transaction")
        }))
      },
      read: "reader"
    }
  }))
}));

describe("TokenInterface", () => {
  let tokenInterface: TokenInterface<1>;

  let mockedYearn: Yearn<ChainId>;

  beforeEach(() => {
    mockedYearn = new (Yearn as jest.Mock<Yearn<ChainId>>)();
    tokenInterface = new TokenInterface(mockedYearn, 1, new Context({}));
    jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("price", () => {
    it("should should get the exchange rate between two tokens", async () => {
      const actualPrice = await tokenInterface.price("0x000", "0x001");

      expect(actualPrice).toEqual(1);
      expect(getPriceFromRouterMock).toHaveBeenCalledTimes(1);
      expect(getPriceFromRouterMock).toHaveBeenCalledWith("0x000", "0x001");
    });
  });

  describe("priceUsdc", () => {
    it("should get the suggested Usdc exchange rate for a token", async () => {
      getPriceUsdcMock.mockResolvedValue(0.000001);

      const actualPriceUsdc = await tokenInterface.priceUsdc("0x000");

      expect(actualPriceUsdc).toEqual(0.000001);
      expect(getPriceUsdcMock).toHaveBeenCalledTimes(1);
      expect(getPriceUsdcMock).toHaveBeenCalledWith("0x000", undefined);
    });

    it("should get the suggested Usdc exchange rate for list of tokens", async () => {
      getPriceUsdcMock.mockResolvedValueOnce(0.000001).mockResolvedValueOnce(0.000002);

      const actualPriceUsdc = await tokenInterface.priceUsdc(["0x000", "0x001"]);

      expect(actualPriceUsdc).toEqual({
        "0x000": 0.000001,
        "0x001": 0.000002
      });
      expect(getPriceUsdcMock).toHaveBeenCalledTimes(2);
      expect(getPriceUsdcMock).toHaveBeenNthCalledWith(1, "0x000", undefined);
      expect(getPriceUsdcMock).toHaveBeenNthCalledWith(2, "0x001", undefined);
    });

    it("should throw when network is not supported", async () => {
      tokenInterface = new TokenInterface(mockedYearn, 42 as ChainId, new Context({}));

      try {
        await tokenInterface.priceUsdc(["0x000", "0x001"]);
      } catch (error) {
        expect(error).toStrictEqual(new SdkError("the chain 42 hasn't been implemented yet"));
        expect(getPriceUsdcMock).not.toHaveBeenCalled();
      }
    });
  });

  describe("balances", () => {
    beforeEach(() => {
      jest.spyOn(CachedFetcher.prototype, "fetch").mockResolvedValue(undefined);
    });
    const vaultToken = createMockToken({
      address: "0x001",
      name: "vaultToken",
      dataSource: "vaults"
    });
    const vaultTokenNoBalance = createMockToken({
      address: "0x000",
      name: "vaultToken without balance",
      dataSource: "vaults"
    });
    const ironBankToken = createMockToken({
      address: "0x002",
      name: "ironBankToken",
      dataSource: "ironBank"
    });
    const zapperToken = createMockToken({
      address: "0x003",
      name: "zapperToken",
      dataSource: "zapper"
    });
    const vaultTokenWithBalance = createMockBalance({
      address: "0x001",
      token: createMockToken({
        name: "vaultTokenWithBalance"
      })
    });
    const vaultTokenWithoutBalance = createMockBalance({
      address: "0x000",
      balance: "0",
      token: createMockToken({
        name: "vaultTokenWithoutBalance"
      })
    });
    const ironBankTokenWithBalance = createMockBalance({
      address: "0x002",
      token: createMockToken({
        name: "ironBankTokenWithBalance"
      })
    });
    const zapperTokenWithBalance = createMockBalance({
      address: "0x003",
      token: createMockToken({
        name: "zapperTokenWithBalance"
      })
    });

    ([1, 1337] as ChainId[]).forEach(chainId =>
      describe(`when chainId is ${chainId}`, () => {
        beforeEach(() => {
          tokenInterface = new TokenInterface(mockedYearn, chainId, new Context({}));
          tokenInterface.supported = jest
            .fn()
            .mockResolvedValue([vaultToken, vaultTokenNoBalance, ironBankToken, zapperToken]);
        });

        it("should return balances for all supported tokens", async () => {
          vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
          ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);
          zapperBalancesMock.mockResolvedValue([zapperTokenWithBalance]);

          const actualBalances = await tokenInterface.balances("0xAccount");

          expect(actualBalances.length).toEqual(3);
          expect(actualBalances).toEqual(
            expect.arrayContaining([vaultTokenWithBalance, ironBankTokenWithBalance, zapperTokenWithBalance])
          );
          expect(zapperBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(vaultsBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(ironBankBalancesMock).toHaveBeenCalledWith("0xAccount");
        });

        it("should filter supported tokens when address list is given", async () => {
          vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
          ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);
          zapperBalancesMock.mockResolvedValue([zapperTokenWithBalance]);

          const actualBalances = await tokenInterface.balances("0xAccount", [ironBankToken.address]);

          expect(actualBalances.length).toEqual(1);
          expect(actualBalances).toEqual(expect.arrayContaining([ironBankTokenWithBalance]));
          expect(zapperBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(vaultsBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(ironBankBalancesMock).toHaveBeenCalledWith("0xAccount");
        });

        it("should log error message when zapper fails but return other balances", async () => {
          zapperBalancesMock.mockImplementation(() => {
            throw new Error("zapper balances failed!");
          });
          vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
          ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);

          const actualBalances = await tokenInterface.balances("0xAccount", [vaultToken.address]);

          expect(actualBalances.length).toEqual(1);
          expect(actualBalances).toEqual(expect.arrayContaining([vaultTokenWithBalance]));
          expect(vaultsBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(ironBankBalancesMock).toHaveBeenCalledWith("0xAccount");
        });
      })
    );

    ([250, 42161] as ChainId[]).forEach(chainId =>
      describe(`when chainId is ${chainId}`, () => {
        beforeEach(() => {
          tokenInterface = new TokenInterface(mockedYearn, chainId, new Context({}));
          tokenInterface.supported = jest.fn().mockResolvedValue([vaultToken, vaultTokenNoBalance, ironBankToken]);
        });

        it("should return balances for all supported tokens", async () => {
          vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
          ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);

          const actualBalances = await tokenInterface.balances("0xAccount");

          expect(actualBalances.length).toEqual(2);
          expect(actualBalances).toEqual(expect.arrayContaining([vaultTokenWithBalance, ironBankTokenWithBalance]));
          expect(zapperBalancesMock).not.toHaveBeenCalled();
          expect(vaultsBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(ironBankBalancesMock).toHaveBeenCalledWith("0xAccount");
        });

        it("should filter supported tokens when address list is given", async () => {
          vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
          ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);

          const actualBalances = await tokenInterface.balances("0xAccount", [vaultToken.address]);

          expect(actualBalances.length).toEqual(1);
          expect(actualBalances).toEqual(expect.arrayContaining([vaultTokenWithBalance]));
          expect(zapperBalancesMock).not.toHaveBeenCalled();
          expect(vaultsBalancesMock).toHaveBeenCalledWith("0xAccount");
          expect(ironBankBalancesMock).toHaveBeenCalledWith("0xAccount");
        });
      })
    );

    describe("when chainId is not supported", () => {
      beforeEach(() => {
        tokenInterface = new TokenInterface(mockedYearn, 42 as ChainId, new Context({}));
        zapperBalancesMock.mockResolvedValue([zapperTokenWithBalance]);
        vaultsBalancesMock.mockResolvedValue([vaultTokenWithBalance, vaultTokenWithoutBalance]);
        ironBankBalancesMock.mockResolvedValue([ironBankTokenWithBalance]);
      });

      it("should return an empty array and log the error", async () => {
        const actualBalances = await tokenInterface.balances("0x001");

        expect(actualBalances).toEqual([]);
        expect(console.error).toHaveBeenCalledWith("the chain 42 hasn't been implemented yet");
        expect(zapperBalancesMock).not.toHaveBeenCalled();
        expect(vaultsBalancesMock).not.toHaveBeenCalled();
        expect(ironBankBalancesMock).not.toHaveBeenCalled();
      });
    });
  });

  describe("supported", () => {
    describe("when the supported tokens are cached", () => {
      const cachedToken = createMockToken();

      beforeEach(() => {
        jest.spyOn(CachedFetcher.prototype, "fetch").mockResolvedValue([cachedToken]);
      });

      it("should return the supported tokens cached", async () => {
        const actualSupportedTokensCached = await tokenInterface.supported();

        expect(actualSupportedTokensCached).toEqual([cachedToken]);
      });
    });

    describe("when the supported tokens are not cached", () => {
      beforeEach(() => {
        jest.spyOn(CachedFetcher.prototype, "fetch").mockResolvedValue(undefined);
      });

      ([1, 1337] as ChainId[]).forEach(chainId =>
        describe(`when chainId is ${chainId}`, () => {
          let ironBankToken: Token;
          let vaultsToken: Token;

          beforeEach(() => {
            tokenInterface = new TokenInterface(mockedYearn, chainId, new Context({}));
            ironBankToken = createMockToken({ address: "0x001", symbol: "IRON", name: "Iron Token" });
            vaultsToken = createMockToken({
              address: "0x002",
              symbol: "VAULT",
              name: "Vault Token"
            });
            vaultsTokensMock.mockResolvedValue([vaultsToken]);
            ironBankTokensMock.mockResolvedValue([ironBankToken]);
          });

          it("should fetch all the tokens from Zapper, Vaults and Iron", async () => {
            const supportedZapperTokenWithIcon = createMockToken({ address: "0x003" });
            const supportedZapperTokenWithoutIcon = createMockToken({ address: "0x004" });

            zapperSupportedTokensMock.mockResolvedValue([
              supportedZapperTokenWithIcon,
              supportedZapperTokenWithoutIcon
            ]);
            assetReadyThenMock.mockResolvedValue({ "0x003": "image.png" });

            const actualSupportedTokens = await tokenInterface.supported();

            expect(actualSupportedTokens.length).toEqual(4);
            expect(actualSupportedTokens).toEqual(
              expect.arrayContaining([
                { ...supportedZapperTokenWithIcon, icon: "image.png", supported: { zapper: true } },
                { ...supportedZapperTokenWithoutIcon, supported: { zapper: true } },
                vaultsToken,
                ironBankToken
              ])
            );
            expect(zapperSupportedTokensMock).toHaveBeenCalledTimes(1);
            expect(vaultsTokensMock).toHaveBeenCalledTimes(1);
            expect(ironBankTokensMock).toHaveBeenCalledTimes(1);
            expect(assetReadyThenMock).toHaveBeenCalledTimes(1);
          });

          it("should overwrite zapper tokens' data with our own in case of duplicates", async () => {
            const ironBankTokenAlsoInZapper = createMockToken({
              address: "0x001",
              symbol: "IRON",
              name: "Iron Token in Zapper",
              icon: "iron-bank.svg",
              priceUsdc: "10"
            });
            const vaultsTokenAlsoInZapper = createMockToken({
              address: "0x002",
              symbol: "VAULT",
              name: "Vault Token in Zapper",
              icon: "vaults.svg",
              priceUsdc: "20"
            });
            const ironBankTokenNotInZapper = createMockToken({
              address: "0x003",
              symbol: "IRON2",
              name: "Iron Token 2",
              icon: "iron-bank-2.svg",
              priceUsdc: "12"
            });
            const vaultsTokenNotInZapper = createMockToken({
              address: "0x004",
              symbol: "VAULT2",
              name: "Vault Token 2",
              icon: "vaults-2.svg",
              priceUsdc: "22"
            });
            const ironBankTokenInVaults = createMockToken({
              address: "0x005",
              symbol: "IRON3",
              name: "Iron Token in Vaults",
              icon: "iron-bank-3.svg",
              priceUsdc: "13"
            });
            const vaultsTokenInIronBank = createMockToken({
              address: "0x005",
              symbol: "VAULT3",
              name: "Vault Token in Iron Bank",
              icon: "vaults-3.svg",
              priceUsdc: "23"
            });

            ironBankTokensMock.mockResolvedValue([
              vaultsTokenAlsoInZapper,
              ironBankTokenNotInZapper,
              ironBankTokenInVaults
            ]);
            vaultsTokensMock.mockResolvedValue([
              ironBankTokenAlsoInZapper,
              vaultsTokenNotInZapper,
              vaultsTokenInIronBank
            ]);
            zapperSupportedTokensMock.mockResolvedValue([
              {
                ...ironBankTokenAlsoInZapper,
                priceUsdc: "1",
                supported: {
                  zapper: true
                }
              },
              {
                ...vaultsTokenAlsoInZapper,
                priceUsdc: "2",
                supported: {
                  zapper: true
                }
              }
            ]);
            assetReadyThenMock.mockResolvedValue({ "0x001": "zapper-iron-bank.svg", "0x002": "zapper-vaults.svg" });

            const actualSupportedTokens = await tokenInterface.supported();

            expect(actualSupportedTokens.length).toEqual(5);
            expect(actualSupportedTokens).toEqual(
              expect.arrayContaining([
                {
                  ...ironBankTokenAlsoInZapper,
                  supported: {
                    zapper: true
                  }
                },
                vaultsTokenNotInZapper,
                {
                  ...vaultsTokenAlsoInZapper,
                  supported: {
                    zapper: true
                  }
                },
                ironBankTokenNotInZapper,
                vaultsTokenInIronBank
              ])
            );
            expect(zapperSupportedTokensMock).toHaveBeenCalledTimes(1);
            expect(vaultsTokensMock).toHaveBeenCalledTimes(1);
            expect(ironBankTokensMock).toHaveBeenCalledTimes(1);
            expect(assetReadyThenMock).toHaveBeenCalledTimes(1);
          });

          it("should return internal tokens when zapper fails", async () => {
            zapperSupportedTokensMock.mockImplementation(() => {
              throw new Error("zapper balances failed!");
            });

            const actualSupportedTokens = await tokenInterface.supported();

            expect(actualSupportedTokens.length).toEqual(2);
            expect(actualSupportedTokens).toEqual([vaultsToken, ironBankToken]);
            expect(zapperSupportedTokensMock).toHaveBeenCalledTimes(1);
            expect(vaultsTokensMock).toHaveBeenCalledTimes(1);
            expect(ironBankTokensMock).toHaveBeenCalledTimes(1);
            expect(assetReadyThenMock).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalled();
          });
        })
      );

      ([250, 42161] as ChainId[]).forEach(chainId =>
        describe(`when chainId is ${chainId}`, () => {
          let ironBankToken: Token;
          let vaultsToken: Token;

          beforeEach(() => {
            tokenInterface = new TokenInterface(mockedYearn, chainId, new Context({}));
            ironBankToken = createMockToken({ address: "0x001", symbol: "IRON", name: "Iron Token" });
            vaultsToken = createMockToken({
              address: "0x002",
              symbol: "VAULT",
              name: "Vault Token"
            });
            vaultsTokensMock.mockResolvedValue([vaultsToken]);
            ironBankTokensMock.mockResolvedValue([ironBankToken]);
          });

          it("should fetch all the tokens only from Vaults and Iron Bank (not Zapper)", async () => {
            const actualSupportedTokens = await tokenInterface.supported();

            expect(actualSupportedTokens.length).toEqual(2);
            expect(actualSupportedTokens).toEqual(expect.arrayContaining([vaultsToken, ironBankToken]));
            expect(zapperSupportedTokensMock).not.toHaveBeenCalled();
            expect(assetReadyThenMock).not.toHaveBeenCalled();
            expect(vaultsTokensMock).toHaveBeenCalledTimes(1);
            expect(ironBankTokensMock).toHaveBeenCalledTimes(1);
          });

          it("should return vaults token instead of iron bank tokens in case of duplicates", async () => {
            const ironBankToken = createMockToken({
              address: "0x001",
              symbol: "IRON",
              name: "Iron Token",
              icon: "iron-bank.svg",
              priceUsdc: "10"
            });
            const vaultsToken = createMockToken({
              address: "0x002",
              symbol: "VAULT",
              name: "Vault Token",
              icon: "vaults.svg",
              priceUsdc: "20"
            });
            const ironBankTokenInVaults = createMockToken({
              address: "0x003",
              symbol: "IRON3",
              name: "Iron Token in Vaults",
              icon: "iron-bank-3.svg",
              priceUsdc: "13"
            });
            const vaultsTokenInIronBank = createMockToken({
              address: "0x003",
              symbol: "VAULT3",
              name: "Vault Token in Iron Bank",
              icon: "vaults-3.svg",
              priceUsdc: "23"
            });

            ironBankTokensMock.mockResolvedValue([ironBankToken, ironBankTokenInVaults]);
            vaultsTokensMock.mockResolvedValue([vaultsToken, vaultsTokenInIronBank]);

            const actualSupportedTokens = await tokenInterface.supported();

            expect(actualSupportedTokens.length).toEqual(3);
            expect(actualSupportedTokens).toEqual(
              expect.arrayContaining([ironBankToken, vaultsToken, vaultsTokenInIronBank])
            );
            expect(zapperSupportedTokensMock).not.toHaveBeenCalled();
            expect(assetReadyThenMock).not.toHaveBeenCalled();
            expect(vaultsTokensMock).toHaveBeenCalledTimes(1);
            expect(ironBankTokensMock).toHaveBeenCalledTimes(1);
          });
        })
      );

      (([42] as unknown) as ChainId[]).forEach(chainId =>
        it(`should return an empty array when chainId is ${chainId}`, async () => {
          tokenInterface = new TokenInterface(mockedYearn, chainId, new Context({}));

          const actualSupportedTokens = await tokenInterface.supported();

          expect(actualSupportedTokens).toEqual([]);
          expect(zapperSupportedTokensMock).not.toHaveBeenCalled();
          expect(assetReadyThenMock).not.toHaveBeenCalled();
        })
      );
    });
  });

  describe("approve", () => {
    describe("when the vault token is the same as the token", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken().address;
        sendTransactionMock.mockResolvedValue(true);
      });

      describe("when it has a partner id defined", () => {
        it("should approve the partner contract to spend a token on a direct deposit", async () => {
          mockedYearn = new (Yearn as jest.Mock<Yearn<ChainId>>)();
          mockedYearn.services.partner = new ((PartnerService as unknown) as jest.Mock<PartnerService<ChainId>>)();
          tokenInterface = new TokenInterface(mockedYearn, 1, new Context({}));
          approveMock.mockReturnValue("partner deposit");
          const actualApprove = await tokenInterface.approveDeposit(vault.address, vault.token, token, "1", "0x001");

          expect(actualApprove).toEqual(true);
          expect(Contract).toHaveBeenCalledTimes(1);
          expect(Contract).toHaveBeenCalledWith(
            token,
            [
              "function approve(address _spender, uint256 _value) public",
              "function allowance(address _owner, address _spender) public view returns (uint256)"
            ],
            {
              sendTransaction: expect.any(Function)
            }
          );
          expect(approveMock).toHaveBeenCalledTimes(1);
          expect(approveMock).toHaveBeenCalledWith("0x0001partner", "1");
          expect(sendTransactionMock).toHaveBeenCalledTimes(1);
          expect(sendTransactionMock).toHaveBeenCalledWith("partner deposit");
        });
      });

      it("should approve vault to spend a token on a direct deposit", async () => {
        approveMock.mockReturnValue("direct deposit");
        const actualApprove = await tokenInterface.approveDeposit(vault.address, vault.token, token, "1", "0x001");

        expect(actualApprove).toEqual(true);

        expect(Contract).toHaveBeenCalledTimes(1);
        expect(Contract).toHaveBeenCalledWith(
          token,
          [
            "function approve(address _spender, uint256 _value) public",
            "function allowance(address _owner, address _spender) public view returns (uint256)"
          ],
          {
            sendTransaction: expect.any(Function)
          }
        );
        expect(approveMock).toHaveBeenCalledTimes(1);
        expect(approveMock).toHaveBeenCalledWith(vault.address, "1");
        expect(sendTransactionMock).toHaveBeenCalledTimes(1);
        expect(sendTransactionMock).toHaveBeenCalledWith("direct deposit");
      });
    });

    describe("when Ether is beind sent", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = EthAddress;
      });

      it("should return true", async () => {
        const actualApprove = await tokenInterface.approveDeposit(vault.address, vault.token, token, "1", "0x001");

        expect(actualApprove).toEqual(true);
      });
    });

    describe("zapInApprovalState", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken({ address: "0x999" }).address;
        zapperGasMock.mockResolvedValue({
          standard: 1,
          instant: 2,
          fast: 3
        });
      });

      describe("when is not approved", () => {
        beforeEach(() => {
          zapperZapInApprovalStateMock.mockResolvedValue({
            isApproved: false
          });
          zapperZapInApprovalTransactionMock.mockResolvedValue({
            data: "data",
            to: "0x000",
            from: "0x001",
            gasPrice: "1"
          });
        });

        it("should approve vault to spend a token on zapIn", async () => {
          const actualApprove = await tokenInterface.approveDeposit(vault.address, vault.token, token, "1", "0x001");

          expect(actualApprove).toEqual("transaction");
          expect(zapperZapInApprovalTransactionMock).toHaveBeenCalledTimes(1);
          expect(zapperZapInApprovalTransactionMock).toHaveBeenCalledWith("0x001", "0x999", "3000000000", "yearn");
        });
      });

      describe("when is approved", () => {
        beforeEach(() => {
          zapperZapInApprovalStateMock.mockResolvedValue({
            isApproved: true
          });
        });

        it("should return true", async () => {
          const actualApprove = await tokenInterface.approveDeposit(vault.address, vault.token, token, "1", "0x001");

          expect(actualApprove).toEqual(true);
        });
      });
    });
  });

  describe("allowance", () => {
    describe("when the vault token is the same as the token", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken().address;
        sendTransactionMock.mockResolvedValue(true);
      });

      describe("when it has a partner id defined", () => {
        it("should get the allowance for the partner contract", async () => {
          mockedYearn = new (Yearn as jest.Mock<Yearn<ChainId>>)();
          mockedYearn.services.partner = new ((PartnerService as unknown) as jest.Mock<PartnerService<ChainId>>)();
          tokenInterface = new TokenInterface(mockedYearn, 1, new Context({}));
          allowanceMock.mockReturnValue("10");
          const actualAllowance = await tokenInterface.allowance(vault.address, vault.token, token, "0x001");

          expect(Contract).toHaveBeenCalledTimes(1);
          expect(Contract).toHaveBeenCalledWith(
            token,
            [
              "function approve(address _spender, uint256 _value) public",
              "function allowance(address _owner, address _spender) public view returns (uint256)"
            ],
            "reader"
          );
          expect(actualAllowance).toEqual({ amount: "10", owner: "0x001", spender: "0x0001partner", token });
          expect(allowanceMock).toHaveBeenCalledTimes(1);
          expect(allowanceMock).toHaveBeenCalledWith("0x001", "0x0001partner");
        });
      });

      it("should approve vault to spend a token on a direct deposit", async () => {
        allowanceMock.mockReturnValue("20");
        const actualAllowance = await tokenInterface.allowance(vault.address, vault.token, token, "0x001");

        expect(Contract).toHaveBeenCalledTimes(1);
        expect(Contract).toHaveBeenCalledWith(
          token,
          [
            "function approve(address _spender, uint256 _value) public",
            "function allowance(address _owner, address _spender) public view returns (uint256)"
          ],
          "reader"
        );
        expect(actualAllowance).toEqual({ amount: "20", owner: "0x001", spender: vault.address, token });
        expect(allowanceMock).toHaveBeenCalledTimes(1);
        expect(allowanceMock).toHaveBeenCalledWith(vault.address, "0x001");
      });
    });

    describe("when Ether is beind sent", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = EthAddress;
      });

      it("should return true", async () => {
        const actualApprove = await tokenInterface.allowance(vault.address, vault.token, token, "0x00account");

        expect(actualApprove).toEqual({ amount: MaxUint256.toString(), owner: "0x00account", spender: "0x001", token });
      });
    });

    describe("zapInApprovalState", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken({ address: "0x999" }).address;
        zapperZapInApprovalStateMock.mockResolvedValue({
          isApproved: false,
          ownerAddress: "owner",
          spenderAddress: "spender",
          allowance: "allowance"
        });
      });

      it("should approve vault to spend a token on zapIn", async () => {
        const actualAllowance = await tokenInterface.allowance(vault.address, vault.token, token, "0x001");

        expect(actualAllowance).toEqual({ amount: "allowance", owner: "owner", spender: "spender", token });
        expect(zapperZapInApprovalStateMock).toHaveBeenCalledTimes(1);
        expect(zapperZapInApprovalStateMock).toHaveBeenCalledWith("0x001", "0x999", "yearn");
      });
    });
  });

  describe("approveZapOut", () => {
    describe("when the vault token is not the same as the token", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken({ address: "0x999" }).address;
      });

      it("should return false", async () => {
        const actualApproveZapOut = await tokenInterface.approveZapOut(vault, token, "0x001");

        expect(actualApproveZapOut).toEqual(false);
      });
    });

    describe("zapInApprovalState", () => {
      let vault: Asset<"VAULT_V2">;
      let token: Address;

      beforeEach(() => {
        vault = createMockAssetStaticVaultV2();
        token = createMockToken().address;
        zapperGasMock.mockResolvedValue({
          standard: 1,
          instant: 2,
          fast: 3
        });
      });

      describe("when is not approved", () => {
        beforeEach(() => {
          zapperZapOutApprovalStateMock.mockResolvedValue({
            isApproved: false
          });
          zapperZapOutApprovalTransactionMock.mockResolvedValue({
            data: "data",
            to: "0x000",
            from: "0x001",
            gasPrice: "1"
          });
        });

        it("should approve vault to spend a vault token on zapOut", async () => {
          const actualApproveZapOut = await tokenInterface.approveZapOut(vault, token, "0x001");

          expect(actualApproveZapOut).toEqual("transaction");
          expect(zapperZapOutApprovalStateMock).toHaveBeenCalledTimes(1);
          expect(zapperZapOutApprovalStateMock).toHaveBeenCalledWith("0x001", "0x001");
          expect(zapperZapOutApprovalTransactionMock).toHaveBeenCalledTimes(1);
          expect(zapperZapOutApprovalTransactionMock).toHaveBeenCalledWith("0x001", "0x001", "3000000000");
        });
      });

      describe("when is approved", () => {
        beforeEach(() => {
          zapperZapOutApprovalStateMock.mockResolvedValue({
            isApproved: true
          });
        });

        it("should return false", async () => {
          const actualApproveZapOut = await tokenInterface.approveZapOut(vault, token, "0x001");

          expect(actualApproveZapOut).toEqual(false);
        });
      });
    });
  });

  describe("icon", () => {
    it("should call AssetService#icon with the address", () => {
      tokenInterface.icon("0x001");

      expect(assetIconMock).toHaveBeenCalledTimes(1);
      expect(assetIconMock).toHaveBeenCalledWith("0x001");
    });

    it("sshould call AssetService#icon with a list of the address", () => {
      tokenInterface.icon(["0x001", "0x002"]);

      expect(assetIconMock).toHaveBeenCalledTimes(1);
      expect(assetIconMock).toHaveBeenCalledWith(["0x001", "0x002"]);
    });
  });

  describe("metadata", () => {
    const tokenMetadataFromMetaService: TokenMetadata[] = [
      {
        address: "tokenMetadataAddressFromMetaService",
        description: "foo"
      },
      {
        address: "0x001",
        description: "bar"
      }
    ];

    beforeEach(() => {
      metaTokensMock.mockResolvedValue(tokenMetadataFromMetaService);
    });

    describe("when the token medatada is cached", () => {
      let tokenMetadata: TokenMetadata[];

      beforeEach(() => {
        tokenMetadata = [
          {
            address: "tokenMetadataAddress",
            description: "foo"
          },
          {
            address: "0x002",
            description: "bar"
          }
        ];
        jest.spyOn(CachedFetcher.prototype, "fetch").mockResolvedValue(tokenMetadata);
      });

      describe("when there are addresses", () => {
        it("should return the token metadata that include those addresses", async () => {
          const actualMetadata = await tokenInterface.metadata(["0x002"]);

          expect(actualMetadata).toEqual([
            {
              address: "0x002",
              description: "bar"
            }
          ]);
        });
      });

      describe("when there are no addresses", () => {
        it("should return the cached result", async () => {
          const actualMetadata = await tokenInterface.metadata();

          expect(actualMetadata).toEqual(tokenMetadata);
        });
      });
    });

    describe("when the token medatada is not cached", () => {
      beforeEach(() => {
        jest.spyOn(CachedFetcher.prototype, "fetch").mockResolvedValue(undefined);
        metaTokensMock.mockResolvedValue(tokenMetadataFromMetaService);
      });

      describe("when there are addresses", () => {
        it("should return the token metadata that include those addresses", async () => {
          const actualMetadata = await tokenInterface.metadata(["0x001"]);

          expect(actualMetadata).toEqual([
            {
              address: "0x001",
              description: "bar"
            }
          ]);
        });
      });

      describe("when there are no addresses", () => {
        it("should return the tokens from the meta service", async () => {
          const actualMetadata = await tokenInterface.metadata();

          expect(actualMetadata).toEqual(tokenMetadataFromMetaService);
        });
      });
    });
  });
});
