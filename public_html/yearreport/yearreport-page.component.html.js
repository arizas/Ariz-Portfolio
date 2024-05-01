export default /*html*/ `<style>
    .numeric {
        text-align: right;
    }

    .dailybalancerow_datetime {
        white-space: nowrap;
    }

    .dailybalancerow_balance {
        white-space: nowrap;
    }

    tr.inforow td {
        font-size: 12px;   
    }

    @media screen {
        .table-responsive {
            max-height: 100%;
        }

        table thead,
        table tfoot {
            position: sticky;
        }

        table thead {
            inset-block-start: 0;
            top: 0;
        }

        table tfoot {
            inset-block-end: 0;
            bottom: 0;
        }
    }

    @media print {
        .table-responsive {
            overflow: visible !important;
            display: block;
            width: 100%;
            max-width: none;
        }
    }
    .token_amount {
        font-size: 12px;
        white-space: nowrap;
    }
</style>
<div class="row">
    <div class="col-md-3">
        <label for="yearselect" class="form-label">Select year</label>   
        <select id="yearselect" class="form-select"></select>        
    </div>
    <div class="col-md-3">
        <label for="tokenselect" class="form-label">Fungible token</label>
        <select class="form-select" aria-label="Select fungible token" id="tokenselect">
            <option value="">NEAR</option>
        </select>        
    </div>
    <div class="col-md-3">
        <label for="currencyselect" class="form-label">Currency</label>
        <select class="form-select" aria-label="Select conversion currency" id="currencyselect">
            <option value="">No conversion</option>
        </select>        
    </div>
    <div class="col-md-3" style="text-align: right">
        <button class="btn btn-light" id="print_all_tokens_button">Print (all tokens)</button>
        <button class="btn btn-light" id="print_current_token_button">Print (selected token)</button>
    </div>
</div>

<template id="dailybalancerowtemplate">
    <tr>
        <td class="dailybalancerow_datetime"></td>
        <td class="dailybalancerow_totalbalance numeric"></td>
        <td class="dailybalancerow_change numeric"></td>
        <td class="dailybalancerow_accountbalance numeric"></td>
        <td class="dailybalancerow_accountchange numeric"></td>
        <td class="dailybalancerow_stakingbalance numeric"></td>
        <td class="dailybalancerow_stakingchange numeric"></td>
        <td class="dailybalancerow_stakingreward numeric"></td>
        <td class="dailybalancerow_received numeric"></td>
        <td class="dailybalancerow_deposit numeric"></td>
        <td class="dailybalancerow_withdrawal numeric"></td>
        <td class="dailybalancerow_profit numeric"></td>
        <td class="dailybalancerow_loss numeric"></td>
        <td><button class="btn btn-light show_transactions_button">&#128194;</button></td>
    </tr>
    <tr class="inforow bg-info">
        <td colspan="14" >
            <table class="table table-sm table-borderless">
                <thead>
                    <tr>
                        <th scope="col">acquisition date</th>
                        <th scope="col">acquired amount</th>
                        <th scope="col">acquisition price</th>
                        <th scope="col">realized amount</th>
                        <th scope="col">realization price</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        </td>
    </tr>
</template>
<div class="table-responsive">
    <table class="table table-sm table-hover">
        <thead class="table-dark">
            <th scope="col">
                date
            </th>
            <th scope="col">
                total balance
            </th>
            <th scope="col">
                change
            </th>
            <th scope="col">
                account balance
            </th>
            <th scope="col">
                change
            </th>
            <th scope="col">
                staking balance
            </th>
            <th scope="col">
                change
            </th>
            <th scope="col">
                reward
            </th>
            <th scope="col">
                ext received
            </th>
            <th scope="col">
                deposit
            </th>
            <th scope="col">
                withdrawals
            </th>
            <th scope="col">
                profit
            </th>
            <th scope="col">
                loss
            </th>
            <th>
                &nbsp;
            </th>
        </thead>
        <tbody id="dailybalancestable">

        </tbody>
        <tfoot class="table-dark">
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col">

            </th>
            <th scope="col" class="numeric" id="totalreward">

            </th>
            <th scope="col" class="numeric" id="totalreceived">

            </th>
            <th scope="col" class="numeric" id="totaldeposit">

            </th>
            <th scope="col" class="numeric" id="totalwithdrawal">

            </th>
            <th scope="col" class="numeric" id="totalprofit">

            </th>
            <th scope="col" class="numeric" id="totalloss">

            </th>
            <th></th>
        </tfoot>
    </table>
</div>
<div class="modal" tabindex="-1" id="show_transactions_modal">
  <div class="modal-dialog modal-lg">
    <div class="modal-content">
      <div class="modal-header">
        <h5 class="modal-title">Transactions</h5>
        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
      </div>
      <div class="modal-body">
        <p>Modal body text goes here.</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
      </div>
    </div>
  </div>
</div>
`;