/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/leash.json`.
 */
export type Leash = {
  "address": "3Szo7yDv7saKcXDuYA3BCgRV8YrajNFNCxU3c1WRAHu6",
  "metadata": {
    "name": "leash",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "docs": [
    "Leash: an on-chain spending policy for AI agents.",
    "The owner funds a vault and sets limits; the agent key can only pay within them."
  ],
  "instructions": [
    {
      "name": "agentPay",
      "discriminator": [
        191,
        210,
        112,
        56,
        82,
        215,
        140,
        233
      ],
      "accounts": [
        {
          "name": "agent",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agent",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "recipientTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "intentHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "createVault",
      "discriminator": [
        29,
        237,
        247,
        208,
        193,
        82,
        54,
        135
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "agent"
        },
        {
          "name": "mint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "agent"
              }
            ]
          }
        },
        {
          "name": "vaultTokenAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "tokenProgram"
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "perTxMax",
          "type": "u64"
        },
        {
          "name": "dailyCap",
          "type": "u64"
        },
        {
          "name": "allowlist",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "deposit",
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "depositor",
          "signer": true
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agent",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "depositorTokenAccount",
          "writable": true
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "revoke",
      "discriminator": [
        170,
        23,
        31,
        34,
        133,
        173,
        93,
        242
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agent",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "updatePolicy",
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agent",
                "account": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "perTxMax",
          "type": "u64"
        },
        {
          "name": "dailyCap",
          "type": "u64"
        },
        {
          "name": "allowlist",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "withdraw",
      "discriminator": [
        183,
        18,
        70,
        156,
        148,
        109,
        161,
        34
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.owner",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.agent",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vaultTokenAccount",
          "writable": true
        },
        {
          "name": "ownerTokenAccount",
          "docs": [
            "Funds can only go back to the owner."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "paymentEvent",
      "discriminator": [
        132,
        136,
        157,
        119,
        91,
        254,
        225,
        20
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "vaultRevoked",
      "msg": "Vault is revoked by the owner"
    },
    {
      "code": 6001,
      "name": "policyExpired",
      "msg": "Vault policy has expired"
    },
    {
      "code": 6002,
      "name": "invalidAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6003,
      "name": "exceedsPerTxLimit",
      "msg": "Amount exceeds the per-payment limit"
    },
    {
      "code": 6004,
      "name": "exceedsDailyCap",
      "msg": "Payment would exceed the daily cap"
    },
    {
      "code": 6005,
      "name": "recipientNotAllowed",
      "msg": "Recipient is not on the vault allowlist"
    },
    {
      "code": 6006,
      "name": "wrongMint",
      "msg": "Token account mint does not match the vault mint"
    },
    {
      "code": 6007,
      "name": "allowlistTooLong",
      "msg": "Allowlist can hold at most 8 recipients"
    },
    {
      "code": 6008,
      "name": "mathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6009,
      "name": "unauthorized",
      "msg": "Signer is not allowed to do this on this vault"
    }
  ],
  "types": [
    {
      "name": "paymentEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "docs": [
              "Recipient wallet (owner of the recipient token account), the same key checked against the allowlist."
            ],
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "intentHash",
            "docs": [
              "sha256 of the user's task text."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "spentToday",
            "docs": [
              "Total spent in the current UTC day, including this payment."
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "docs": [
        "Spending policy and counters for one (owner, agent) pair.",
        "Funds live in the vault's token account, whose authority is this PDA."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "Can change policy, revoke and withdraw."
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "The only key that can call `agent_pay`."
            ],
            "type": "pubkey"
          },
          {
            "name": "mint",
            "docs": [
              "Token mint (USDC), fixed at creation."
            ],
            "type": "pubkey"
          },
          {
            "name": "perTxMax",
            "docs": [
              "Max amount per payment, base units."
            ],
            "type": "u64"
          },
          {
            "name": "dailyCap",
            "docs": [
              "Max total per UTC day, base units."
            ],
            "type": "u64"
          },
          {
            "name": "allowlist",
            "docs": [
              "Allowed recipient wallets (token account owners). Only the first `allowlist_len` are used."
            ],
            "type": {
              "array": [
                "pubkey",
                8
              ]
            }
          },
          {
            "name": "allowlistLen",
            "type": "u8"
          },
          {
            "name": "expiresAt",
            "docs": [
              "Unix timestamp after which the agent can no longer pay."
            ],
            "type": "i64"
          },
          {
            "name": "spentToday",
            "docs": [
              "Amount spent in the day `day_index`."
            ],
            "type": "u64"
          },
          {
            "name": "dayIndex",
            "docs": [
              "`unix_timestamp / 86_400` of the current spending window."
            ],
            "type": "i64"
          },
          {
            "name": "revoked",
            "docs": [
              "Set by the owner; blocks every agent payment."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "vaultSeed",
      "docs": [
        "Seed prefix for the Vault PDA: [\"vault\", owner, agent]."
      ],
      "type": "bytes",
      "value": "[118, 97, 117, 108, 116]"
    }
  ]
};
