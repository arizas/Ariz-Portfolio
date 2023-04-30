export default /*html*/ `
<template id="customexchangeraterowtemplate">
    <div class="input-group">
        <input type="date" class="customexchangeratedate form-control"></td>
        <input type="number" class="customexchangerateprice form-control"></td>
        <select class="form-select customexchangeratecurrency" aria-label="Currency">
        </select>
        <select class="form-select customexchangeratebuysell" aria-label="Sell/Buy">
            <option value="sell">Sell</option>
            <option value="buy">Buy</option>
        </select>
        <button class="btn btn-danger removecustomexchangeratebutton"><i class="bi bi-trash"></i></button>
    </div>
</template>

<div class="card">
    <div class="card-header">Custom exchange rates</div>
    <div class="card-body">
        <div id="customexchangeratestable"></div>
    </div>
    <div class="card-footer">
        <button id="addcustomexchangeratebutton" class="btn btn-primary">Add custom exchange rate</button>
    </div>
</div>
`;