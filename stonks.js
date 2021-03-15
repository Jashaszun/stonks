function getPriceText(price) {
    if (price === undefined) {
        return '-';
    }
    
    var text = '';
    if (price < 0) {
        text = '-$' + (-price).toFixed(4);
    } else {
        text = '$' + price.toFixed(4);
    }
    if (text.endsWith('00')) {
        text = text.substr(0, text.length - 2);
    } else if (text.endsWith('0')) {
        text = text.substr(0, text.length - 1);
    }
    return text;
}
function getTodayDate() {
    var date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function storageAvailable(type) {
    var storage;
    try {
        storage = window[type];
        var x = '__storage_test__';
        storage.setItem(x, x);
        storage.removeItem(x);
        return true;
    }
    catch(e) {
        return e instanceof DOMException && (
            // everything except Firefox
            e.code === 22 ||
            // Firefox
            e.code === 1014 ||
            // test name field too, because code might not be present
            // everything except Firefox
            e.name === 'QuotaExceededError' ||
            // Firefox
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
            // acknowledge QuotaExceededError only if there's something already stored
            (storage && storage.length !== 0);
    }
}

var trades = [];
function saveTrades() {
    window.localStorage.setItem("trades", JSON.stringify(trades));
}

var charts = {};
var stockPrices = {};
var minTradeDate;
var maxTradeDate;
window.onload = function(e) {
    $('#tradeDate').val(getTodayDate().toLocaleString().split(',')[0]);
    $('#dateGroup').datepicker({
        format: "m/d/yyyy",
        todayBtn: "linked",
        daysOfWeekHighlighted: "1,2,3,4,5",
        autoclose: true,
        todayHighlight: true
    });

    if (storageAvailable('localStorage')) {
        if (window.localStorage.getItem("trades")) {
            trades = JSON.parse(window.localStorage.getItem("trades"));
            for (var i in trades) {
                addTrade(trades[i], true);
            }
            updateStats();
        }
        if (window.localStorage.getItem("stockPrices")) {
            stockPrices = JSON.parse(window.localStorage.getItem("stockPrices"), function (key, value) {
                // startDate and endDate are in top level for each ticker
                // date is in each price object within the prices of each ticker
                // They're strings, but we want Date objects
                if (key === 'startDate' || key === 'endDate' || key === 'date') {
                    return new Date(value);
                }
                return value;
            });
        }
    } else {
        alert("Warning: localStorage not available on this browser.");
    }

    updateGraphs();
};

function updateGraphs() {
    if (trades.length > 0) {
        var numShares = {};
        var stockMinDates = {};
        var stockMaxDates = {};
        for (var i in trades) {
            var trade = trades[i];
            var tradeDate = new Date(trade.date);
            if (!(trade.ticker in numShares)) {
                numShares[trade.ticker] = 0;
                stockMinDates[trade.ticker] = tradeDate;
                stockMaxDates[trade.ticker] = tradeDate;
            }
            numShares[trade.ticker] += trade.buying ? trade.qty : (-trade.qty);

            if (tradeDate < stockMinDates[trade.ticker]) {
                stockMinDates[trade.ticker] = tradeDate;
            }
            if (tradeDate > stockMaxDates[trade.ticker]) {
                stockMaxDates[trade.ticker] = tradeDate;
            }
        }
        var tickers = Object.keys(numShares);
        tickers.sort();
        for (var i in tickers) {
            if (numShares[tickers[i]] > 0) {
                stockMaxDates[tickers[i]] = getTodayDate();
            }
            if (minTradeDate === undefined || stockMinDates[tickers[i]] < minTradeDate) {
                minTradeDate = stockMinDates[tickers[i]];
            }
            if (maxTradeDate === undefined || stockMaxDates[tickers[i]] > maxTradeDate) {
                maxTradeDate = stockMaxDates[tickers[i]];
            }
        }

        var priceRequests = [];
        for (var i in tickers) {
            var request = {
                ticker: tickers[i],
                startDate: stockMinDates[tickers[i]],
                endDate: stockMaxDates[tickers[i]]
            };

            // If we already have the data, no need to request it
            var needRequest = true;
            if (tickers[i] in stockPrices) {
                var storedData = stockPrices[tickers[i]];
                var storedStartDate = storedData.startDate;
                var storedEndDate = storedData.endDate;
                if (request.startDate >= storedStartDate && request.endDate <= storedEndDate) {
                    needRequest = false;
                }
            }
            if (needRequest) {
                priceRequests.push(request);
            }
        }
        function getStockPrices(priceRequests) {
            if (priceRequests.length > 0) {
                var request = priceRequests[0];
                var startDateStr = request.startDate.getFullYear().toString() + '-' + 
                    (request.startDate.getMonth()+1).toString().padStart(2, '0') + '-' + 
                    request.startDate.getDate().toString().padStart(2, '0');
                var endDateStr = request.endDate.getFullYear().toString() + '-' + 
                    (request.endDate.getMonth()+1).toString().padStart(2, '0') + '-' + 
                    request.endDate.getDate().toString().padStart(2, '0');
                $.getJSON("https://api.polygon.io/v2/aggs/ticker/" + request.ticker + "/range/1/day/" + startDateStr + "/" + endDateStr +
                    "?unadjusted=false&sort=asc&limit=50000&apiKey=UnHyngIUP8cW5jGX17pCpjWipUPDzPr9", function(data) {
                    console.log("Got historical data for " + request.ticker);
                    for (var i in data.results) {
                        // The times are given at 9pm the night before (???), so add 19 hours to get to 4pm of the correct day.
                        data.results[i].t += 19 * 60 * 60 * 1000;
                        data.results[i].date = new Date(data.results[i].t);
                        data.results[i].date = new Date(data.results[i].date.getFullYear(), data.results[i].date.getMonth(), data.results[i].date.getDate());
                    }
                    var storedPrices = {
                        startDate: request.startDate,
                        endDate: request.endDate,
                        prices: data.results
                    };
                    stockPrices[request.ticker] = storedPrices;
                    window.localStorage.setItem("stockPrices", JSON.stringify(stockPrices));
                    
                    // Start on the rest of the requests
                    getStockPrices(priceRequests.slice(1));
                }).fail(function() {
                    setTimeout(function() {
                        getStockPrices(priceRequests);
                    }, 60*1000); // Wait 60s to request the data.
                });
            } else {
                // We got all the data we need!
                updateStockGraphs();
            }
        };
        if (priceRequests.length > 0) {
            // Need more historical data to create graphs
            getStockPrices(priceRequests);
        } else {
            // We already have all the historical data we need to create graphs
            updateStockGraphs();
        }
    } else {
        updateStockGraphs(); // This will end up removing the accordion folds
    }
}
function getGraphData() {
    var tickers = Object.keys(stockPrices);
    tickers.sort();

    var sortedTrades = trades.slice();
    sortedTrades.sort(function (a, b) { return a.date < b.date });
    // sort is stable so same-day trades are still in the same order

    var data = {};
    var allData = {
        'dates': [],
        'holdings': [],
        'totalPL': [],
        'totalPLPercent': []
    };

    for (var i in tickers) {
        data[tickers[i]] = {
            'dates': [undefined],
            'sharePrice': [undefined],
            'sharePriceIndex': undefined,
            'holdings': [],
            'bought': 0,
            'sold': 0,
            'numShares': 0,
            'breakevenPerShare': [],
            'pl': [],
            'plPercent': []
        }
    }

    var date = minTradeDate;
    var tradeIndex = 0;
    while (date <= maxTradeDate) {
        for (var i in tickers) {
            var ticker = tickers[i];
            if (data[ticker].sharePriceIndex === undefined) {
                // We haven't reached the start of this ticker yet
                if (stockPrices[ticker].startDate <= date) {
                    // We have data for the current date
                    for (var j = 0; j < stockPrices[ticker].prices.length; j++) {
                        if (stockPrices[ticker].prices[j].date <= date) {
                            data[ticker].sharePriceIndex = j;
                            data[ticker].sharePrice[0] = stockPrices[ticker].prices[j];
                            data[ticker].dates[0] = date;
                        } else {
                            break;
                        }
                    }
                }
            } else {
                // Do we have new data for this day?
                if (data[ticker].sharePriceIndex + 1 < stockPrices[ticker].prices.length && stockPrices[ticker].prices[data[ticker].sharePriceIndex+1].date.getTime() === date.getTime()) {
                    data[ticker].sharePriceIndex++;
                    data[ticker].sharePrice.push(stockPrices[ticker].prices[data[ticker].sharePriceIndex]);
                    data[ticker].dates.push(date);
                }
            }
        }
        
        var tradesOnDay = [];
        while (tradeIndex < sortedTrades.length && new Date(sortedTrades[tradeIndex].date).getTime() === date.getTime()) {
            tradesOnDay.push(sortedTrades[tradeIndex]);
            tradeIndex++;
        }

        for (var i in tradesOnDay) {
            var trade = tradesOnDay[i];
            data[trade.ticker].bought += trade.buying ? trade.qty * trade.price : 0;
            data[trade.ticker].sold += !trade.buying ? trade.qty * trade.price : 0;
            data[trade.ticker].numShares = trade.buying ? (data[trade.ticker].numShares + trade.qty) : (data[trade.ticker].numShares - trade.qty);
        }

        var allStat = {
            'holdings': { t: date.getTime() + 16*60*60*1000, o: 0, h: 0, l: 0, c: 0 }, // get 4pm of the date
            'totalPL': { t: date.getTime() + 16*60*60*1000, o: 0, h: 0, l: 0, c: 0 }, // same
            'totalPLPercent': { t: date.getTime() + 16*60*60*1000, o: 0, h: 0, l: 0, c: 0 }, // same
        };
        var anyStockHasPrice = false;
        for (var i in tickers) {
            var ticker = tickers[i];
            if (date !== data[ticker].dates[data[ticker].dates.length-1]) {
                continue;
            } else {
                anyStockHasPrice = true;
            }
            var sharePrice = data[ticker].sharePrice[data[ticker].sharePrice.length-1];
            var holdings = {
                t: sharePrice.t,
                o: sharePrice.o * data[ticker].numShares,
                h: sharePrice.h * data[ticker].numShares,
                l: sharePrice.l * data[ticker].numShares,
                c: sharePrice.c * data[ticker].numShares
            };
            data[ticker].holdings.push(holdings);
            data[ticker].breakevenPerShare.push({ t: date, y: data[ticker].numShares > 0 ? ((data[ticker].bought - data[ticker].sold) / data[ticker].numShares) : 0 });
            var pl = {
                t: sharePrice.t,
                o: data[ticker].holdings[data[ticker].holdings.length-1].o + data[ticker].sold - data[ticker].bought,
                h: data[ticker].holdings[data[ticker].holdings.length-1].h + data[ticker].sold - data[ticker].bought,
                l: data[ticker].holdings[data[ticker].holdings.length-1].l + data[ticker].sold - data[ticker].bought,
                c: data[ticker].holdings[data[ticker].holdings.length-1].c + data[ticker].sold - data[ticker].bought
            };
            data[ticker].pl.push(pl);
            data[ticker].plPercent.push({
                t: sharePrice.t,
                o: 100 * data[ticker].pl[data[ticker].pl.length-1].o / data[ticker].bought,
                h: 100 * data[ticker].pl[data[ticker].pl.length-1].h / data[ticker].bought,
                l: 100 * data[ticker].pl[data[ticker].pl.length-1].l / data[ticker].bought,
                c: 100 * data[ticker].pl[data[ticker].pl.length-1].c / data[ticker].bought
            });

            allStat.holdings.o += holdings.o;
            allStat.holdings.h += holdings.h;
            allStat.holdings.l += holdings.l;
            allStat.holdings.c += holdings.c;
            allStat.totalPL.o += pl.o;
            allStat.totalPL.h += pl.h;
            allStat.totalPL.l += pl.l;
            allStat.totalPL.c += pl.c;
        }
        var totalBought = 0;
        for (var i in tickers) {
            totalBought += data[tickers[i]].bought;
        }
        allStat.totalPLPercent.o = 100 * allStat.totalPL.o / totalBought;
        allStat.totalPLPercent.h = 100 * allStat.totalPL.h / totalBought;
        allStat.totalPLPercent.l = 100 * allStat.totalPL.l / totalBought;
        allStat.totalPLPercent.c = 100 * allStat.totalPL.c / totalBought;

        if (anyStockHasPrice) {
            allData.dates.push(date);
            allData.holdings.push(allStat.holdings);
            allData.totalPL.push(allStat.totalPL);
            allData.totalPLPercent.push(allStat.totalPLPercent);
        }

        // Increment date
        date.setTime(date.getTime() + 30*60*60*1000); // add 30 hours, so we're always part-way through the next day
        date = new Date(date.getFullYear(), date.getMonth(), date.getDate()); // Get start of day
    }

    for (var i in tickers) {
        data[tickers[i]].sharePrice = stockPrices[tickers[i]].prices;
    }

    data.all = allData;
    // Remove data for stocks entered and left all in one day
    // The graphs don't work with only one data point
    for (var i in tickers) {
        if (stockPrices[tickers[i]].prices.length <= 1) {
            delete data[tickers[i]];
        }
    }
    return data;
}
var graphData;
function updateStockGraphs() {
    graphData = getGraphData();
    var tickers = Object.keys(graphData);
    tickers.splice(tickers.indexOf('all'), 1);
    tickers.sort();

    var accordions = {};
    $('#stocksAccordion .accordion-item').each(function() {
        var itemId = $(this).children('.accordion-collapse').first().attr('id');
        itemId = itemId.substring('stocks-accordion-'.length);
        accordions[itemId] = $(this);
    });
    var accordionTickers = Object.keys(accordions);
    accordionTickers.splice(accordionTickers.indexOf('all'), 1);
    accordionTickers.sort();
    accordionTickers.splice(0, 0, 'all');

    // If we haven't populated any graphs yet, the All chart still needs to be created
    if (!('all' in charts)) {
        var ctx = document.getElementById('chart-all').getContext('2d');
            ctx.canvas.width = $('#chart-all').parent().innerWidth();
            ctx.canvas.height = $('#chart-all').parent().innerHeight();
            charts['all'] = new Chart(ctx, {
                type: 'ohlc',
                data: {
                    datasets: [{
                        label: 'Total Holdings',
                        data: graphData['all'].holdings
                    }]
                }
            });
    }
    // Add accordions for new tickers
    for (var i in tickers) {
        var ticker = tickers[i];
        if (!(ticker in accordions)) {
            // the "all" accordion is always there, at index 0, so there is a previous
            var prevAccordion = accordions[accordionTickers[i]];
            prevAccordion.after(
                '<div class="accordion-item">' +
                '    <h2 class="accordion-header">' +
                '        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#stocks-accordion-' + ticker + '">' +
                '            ' + ticker +
                '        </button>' +
                '    </h2>' +
                '    <div id="stocks-accordion-' + ticker + '" class="accordion-collapse collapse">' +
                '        <div class="accordion-body">' +
                '            <div class="row m-1">' +
                '                <label class="col-form-label col-md-2" for="chartElementsGroup-' + ticker + '">Chart Elements:</label>' +
                '                <div class="btn-group col-md-6" role="group" id="chartElementsGroup-' + ticker + '">' +
                '                    <input type="radio" class="btn-check" name="chartElementSelection-' + ticker + '" id="sharePriceButton-' + ticker + '" autocomplete="off" onclick="chartElementSelectionClicked(\'' + ticker + '\')">' +
                '                    <label class="btn btn-outline-primary" for="sharePriceButton-' + ticker + '">Share Price</label>' +
                '                    <input type="radio" class="btn-check" name="chartElementSelection-' + ticker + '" id="holdingsButton-' + ticker + '" autocomplete="off" onclick="chartElementSelectionClicked(\'' + ticker + '\')">' +
                '                    <label class="btn btn-outline-primary" for="holdingsButton-' + ticker + '">Holdings</label>' +
                '                    <input type="radio" class="btn-check" name="chartElementSelection-' + ticker + '" id="breakevenButton-' + ticker + '" autocomplete="off" onclick="chartElementSelectionClicked(\'' + ticker + '\')">' +
                '                    <label class="btn btn-outline-primary" for="breakevenButton-' + ticker + '">Breakeven per Share</label>' +
                '                    <input type="radio" class="btn-check" name="chartElementSelection-' + ticker + '" id="plButton-' + ticker + '" autocomplete="off" onclick="chartElementSelectionClicked(\'' + ticker + '\')" checked>' +
                '                    <label class="btn btn-outline-primary" for="plButton-' + ticker + '">Profit/Loss</label>' +
                '                    <input type="radio" class="btn-check" name="chartElementSelection-' + ticker + '" id="plPercentButton-' + ticker + '" autocomplete="off" onclick="chartElementSelectionClicked(\'' + ticker + '\')">' +
                '                    <label class="btn btn-outline-primary" for="plPercentButton-' + ticker + '">Profit/Loss %</label>' +
                '                </div>' +
                '                <div class="col-md-5"></div>' +
                '            </div>' +
                '            <div style="height: 400px; width: 100%; margin: 0px auto">' +
                '                <canvas id="chart-' + ticker + '"></canvas>' +
                '            </div>' +
                '        </div>' +
                '    </div>' +
                '</div>'
            );
            accordionTickers.splice(i + 1, 0, ticker);
            accordions[ticker] = prevAccordion.next();
        }
    }
    // Remove accordions for old tickers (if an item was removed)
    for (var i in accordionTickers) {
        var accordionTicker = accordionTickers[i];
        if (!(accordionTicker in graphData)) {
            accordions[accordionTicker].remove();
            delete charts[accordionTicker];
        }
    }

    // Now we can fill in the graphs
    for (var i in tickers) {
        var ticker = tickers[i];
        var tickerData = graphData[ticker];

        if (!(ticker in charts)) {
            var ctx = document.getElementById('chart-' + ticker).getContext('2d');
            ctx.canvas.width = $('#chart-' + ticker).parent().innerWidth();
            ctx.canvas.height = $('#chart-' + ticker).parent().innerHeight();
            charts[ticker] = new Chart(ctx, {
                type: 'ohlc',
                data: {
                    datasets: [{
                        label: ticker + ' Profit/Loss',
                        data: tickerData.pl
                    }]
                }
            });
        } else {
            charts[ticker].data.datasets[0].data = tickerData.sharePrice;
            charts[ticker].update();
        }
    }
}
function chartTypeSelectionClicked() {
    var isOHLC = $('#ohlcButton').is(':checked');
}
function chartElementSelectionClicked(graph) {
    var dataset;
    var label;
    if (graph === 'all') {
        if ($('#holdingsButton-all').is(':checked')) {
            dataset = graphData['all'].holdings;
            label = "Total Holdings";
        } else if ($('#plButton-all').is(':checked')) {
            dataset = graphData['all'].totalPL;
            label = "Total Profit/Loss"
        } else if ($('#plPercentButton-all').is(':checked')) {
            dataset = graphData['all'].totalPLPercent;
            label = "Total Profit/Loss (%)"
        }
    } else {
        if ($('#sharePriceButton-' + graph).is(':checked')) {
            dataset = graphData[graph].sharePrice;
            label = graph + ' Share Price';
        } else if ($('#holdingsButton-' + graph).is(':checked')) {
            dataset = graphData[graph].holdings;
            label = graph + ' Holdings';
        } else if ($('#breakevenButton-' + graph).is(':checked')) {
            // TODO: line graphs
            // dataset = graphData[graph].breakevenPerShare;
            // label = graph + ' Breakeven per Share';
            dataset = chart.data.datasets[0].data;
            label = chart.data.datasets[0].label;
        } else if ($('#plButton-' + graph).is(':checked')) {
            dataset = graphData[graph].pl;
            label = graph + ' Profit/Loss';
        } else if ($('#plPercentButton-' + graph).is(':checked')) {
            dataset = graphData[graph].plPercent;
            label = graph + ' Profit/Loss (%)';
        }
    }

    
    var chart = charts[graph];
    chart.data.datasets[0].data = dataset;
    chart.data.datasets[0].label = label;
    chart.update();
}

var editingTradeIndex = undefined;
function addTradeBtnClicked() {
    var date = $('#tradeDate').val();
    var buying = $('#buyButton').is(':checked');
    var ticker = $('#tickerInput').val();
    var qty = $('#quantityInput').val();
    var price = $('#priceInput').val();

    if (ticker) {
        $('#tickerInput').removeClass('is-invalid');
    } else  {
        $('#tickerInput').addClass('is-invalid');
    }

    if (qty) {
        $('#quantityInput').removeClass('is-invalid');
    } else {
        $('#quantityInput').addClass('is-invalid');
    }

    if (price) {
        $('#priceInput').removeClass('is-invalid');
    } else {
        $('#priceInput').addClass('is-invalid');
    }

    if (ticker && qty && price) {
        var trade = {
            date: date,
            buying: buying,
            ticker: ticker,
            qty: parseInt(qty),
            price: parseFloat(price)
        };
        if (editingTradeIndex === undefined) {
            addTrade(trade, false);
        } else {
            updateTrade(editingTradeIndex, trade);
        }

        $('#tradeDate').val(getTodayDate().toLocaleString().split(',')[0]);
        $('#buyButton').prop('checked', true);
        $('#sellButton').prop('checked', false);
        $('#tickerInput').val('');
        $('#quantityInput').val('');
        $('#priceInput').val('');
        $('#tickerInput').removeClass('is-invalid');
        $('#quantityInput').removeClass('is-invalid');
        $('#priceInput').removeClass('is-invalid');

        $('#addTradeBtn').html('<i class="bi bi-plus"></i>  Add Trade');
        $('#cancelTradeEditBtn').addClass('cancel-trade-edit-btn-not-displayed');
    }
}
function cancelTradeEditBtnClicked() {
    $('#tradeDate').val(getTodayDate().toLocaleString().split(',')[0]);
    $('#buyButton').prop('checked', true);
    $('#sellButton').prop('checked', false);
    $('#tickerInput').val('');
    $('#quantityInput').val('');
    $('#priceInput').val('');
    $('#tickerInput').removeClass('is-invalid');
    $('#quantityInput').removeClass('is-invalid');
    $('#priceInput').removeClass('is-invalid');

    $('#addTradeBtn').html('<i class="bi bi-plus"></i>  Add Trade');
    $('#cancelTradeEditBtn').addClass('cancel-trade-edit-btn-not-displayed');
}
function removeTradeBtnClicked(removeBtn) {
    var removeIndex = removeBtn.parentElement.parentElement.rowIndex - 1; // 0 is the header
    removeTrade(removeIndex);
}

function addTrade(trade, addingBulk) {
    if (!addingBulk) {
        trades.push(trade);
        saveTrades();
    }

    $('#trades-table tbody').append(
        '<tr class="trade-table-tr trade-table-' + (trade.buying ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
        '    <td>' + trade.date + '</td>' +
        '    <td>' + (trade.buying ? 'Buy' : 'Sell') + '</td>' +
        '    <td>' + trade.ticker + '</td>' +
        '    <td>' + trade.qty.toString() + '</td>' +
        '    <td>' + getPriceText(trade.price) + '</td>' +
        '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
        '</tr>'
    );

    if (!addingBulk) {
        updateStats();
    }
}
function updateTrade(index, newTrade) {
    trades[index] = newTrade;
    saveTrades();

    $('#trades-table tbody').find('tr').eq(index).replaceWith(
        '<tr class="trade-table-tr trade-table-' + (newTrade.buying ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
        '    <td>' + newTrade.date + '</td>' +
        '    <td>' + (newTrade.buying ? 'Buy' : 'Sell') + '</td>' +
        '    <td>' + newTrade.ticker + '</td>' +
        '    <td>' + newTrade.qty.toString() + '</td>' +
        '    <td>' + getPriceText(newTrade.price) + '</td>' +
        '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
        '</tr>'
    );
}
function removeTrade(index) {
    trades.splice(index, 1);
    saveTrades();

    $('#trades-table tbody').find('tr').eq(index).remove();

    updateStats();
}
function tradeDoubleClicked(tradeRowElem) {
    function clearSelection() {
        if(document.selection && document.selection.empty) {
            document.selection.empty();
        } else if(window.getSelection) {
            var sel = window.getSelection();
            sel.removeAllRanges();
        }
    }
    clearSelection();

    editingTradeIndex = tradeRowElem.rowIndex - 1; // 0 is the header
    var trade = trades[editingTradeIndex];
    $('#tradeDate').val(trade.date);
    $('#buyButton').prop('checked', trade.buying);
    $('#sellButton').prop('checked', !trade.buying);
    $('#tickerInput').val(trade.ticker);
    $('#quantityInput').val(trade.qty.toString());
    $('#priceInput').val(trade.price.toFixed(4));
    $('#tickerInput').removeClass('is-invalid');
    $('#quantityInput').removeClass('is-invalid');
    $('#priceInput').removeClass('is-invalid');

    $('#addTradeBtn').html('<i class="bi bi-check"></i>  Save Trade');
    $('#cancelTradeEditBtn').removeClass('cancel-trade-edit-btn-not-displayed');
}

function getTradeStats() {
    var allStats = [];
    var stats = {};
    var prevTradesByTicker = {};
    for (var i in trades) {
        if (!(trades[i].ticker in prevTradesByTicker)) {
            prevTradesByTicker[trades[i].ticker] = {
                date: '',
                buying: true,
                ticker: trades[i].ticker,
                qty: 0,
                price: 0,
                lots: [],
                stockBought: 0,
                stockSold: 0,
                totalBought: 0,
                totalSold: 0,
                pl: undefined,
                plPercent: undefined,
                stockPL: undefined,
                stockPLPercent: undefined,
                totalPL: undefined,
                totalPLPercent: undefined
            };
        }
    }
    var prevAllTrade = {
        date: '',
        buying: true,
        ticker: '',
        qty: 0,
        price: 0,
        lots: [],
        totalBought: 0,
        totalSold: 0,
        pl: undefined,
        plPercent: undefined,
        totalPL: undefined,
        totalPLPercent: undefined
    };
    for (var i in trades) {
        var trade = trades[i];
        if (!(trade.ticker in stats)) {
            stats[trade.ticker] = [];
        }

        var prevStockTrade = prevTradesByTicker[trade.ticker];

        var stat = {
            date: trade.date,
            buying: trade.buying,
            ticker: trade.ticker,
            qty: trade.qty,
            price: trade.price,
            stockBought: prevStockTrade.stockBought + (trade.buying ? trade.qty * trade.price : 0),
            stockSold: prevStockTrade.stockSold + (!trade.buying ? trade.qty * trade.price : 0),
            totalBought: prevAllTrade.totalBought + (trade.buying ? trade.qty * trade.price : 0),
            totalSold: prevAllTrade.totalSold + (!trade.buying ? trade.qty * trade.price : 0),
        };
        var allStat = {
            date: trade.date,
            buying: trade.buying,
            ticker: trade.ticker,
            qty: trade.qty,
            price: trade.price,
            totalBought: prevAllTrade.totalBought + (trade.buying ? trade.qty * trade.price : 0),
            totalSold: prevAllTrade.totalSold + (!trade.buying ? trade.qty * trade.price : 0),
        };
        if (trade.buying) {
            stat.lots = prevStockTrade.lots.concat(new Array(trade.qty).fill(trade.price));
            stat.pl = undefined;
            stat.plPercent = undefined;
            stat.stockPL = prevStockTrade.stockPL;
            stat.stockPLPercent = (stat.stockPL !== undefined ? 100*stat.stockPL/stat.stockBought : undefined);
            stat.totalPL = prevStockTrade.totalPL;
            stat.totalPLPercent = (stat.totalPL !== undefined ? 100*stat.totalPL/stat.totalBought : undefined);

            allStat.lots = stat.lots.slice();
            allStat.pl = undefined;
            allStat.plPercent = undefined;
            allStat.totalPL = prevAllTrade.totalPL;
            allStat.totalPLPercent = (allStat.totalPL !== undefined ? 100*allStat.totalPL/allStat.totalBought : undefined);
        } else {
            var lots = prevStockTrade.lots.slice();
            var soldLots = lots.splice(0, trade.qty);
            stat.lots = lots;
            stat.pl = 0;
            for (var l in soldLots) {
                stat.pl += trade.price - soldLots[l];
            }
            stat.plPercent = 100*stat.pl/stat.stockBought;
            stat.stockPL = (prevStockTrade.stockPL === undefined ? 0 : prevStockTrade.totalPL) + stat.pl;
            stat.stockPLPercent = 100*stat.stockPL/stat.stockBought;
            stat.totalPL = (prevStockTrade.totalPL === undefined ? 0 : prevStockTrade.totalPL) + stat.pl;
            stat.totalPLPercent = 100*stat.totalPL/stat.totalBought;

            allStat.lots = stat.lots.slice();
            allStat.pl = stat.pl;
            allStat.plPercent = 100*allStat.pl/allStat.totalBought;
            allStat.totalPL = (prevAllTrade.totalPL === undefined ? 0 : prevAllTrade.totalPL) + allStat.pl;
            allStat.totalPLPercent = 100*allStat.totalPL/allStat.totalBought;
        }

        stat.breakevenPerShare = stat.lots.length > 0 ? ((stat.stockBought - stat.stockSold) / stat.lots.length) : undefined;

        stats[trade.ticker].push(stat);
        allStats.push(allStat);

        prevTradesByTicker[trade.ticker] = stat;
        prevAllTrade = allStat;
    }
    stats.all = allStats;
    return stats;
}
function updateStats() {
    var stats = getTradeStats();
    var tickers = Object.keys(stats);
    tickers.splice(tickers.indexOf('all'), 1);
    tickers.sort();

    var accordions = {};
    $('#tradesAccordion .accordion-item').each(function() {
        var itemId = $(this).children('.accordion-collapse').first().attr('id');
        itemId = itemId.substring('trades-accordion-'.length);
        accordions[itemId] = $(this);
    });
    var accordionTickers = Object.keys(accordions);
    accordionTickers.splice(accordionTickers.indexOf('all'), 1);
    accordionTickers.sort();
    accordionTickers.splice(0, 0, 'all');

    // Add accordions for new tickers
    for (var i in tickers) {
        var ticker = tickers[i];
        if (!(ticker in accordions)) {
            // the "all" accordion is always there, at index 0, so there is a previous
            var prevAccordion = accordions[accordionTickers[i]];
            prevAccordion.after(
                '<div class="accordion-item">' +
                '    <h2 class="accordion-header">' +
                '        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#trades-accordion-' + ticker + '">' +
                '            ' + ticker +
                '        </button>' +
                '    </h2>' +
                '    <div id="trades-accordion-' + ticker + '" class="accordion-collapse collapse">' +
                '        <div class="accordion-body">' +
                '            <table class="table table-hover" id="trades-stats-' + ticker + '-table">' +
                '                <thead>' +
                '                    <tr>' +
                '                        <th scope="col">Date</th>' +
                '                        <th scope="col">Type</th>' +
                '                        <th scope="col">Qty</th>' +
                '                        <th scope="col">Price</th>' +
                '                        <th scope="col">Stock Bought</th>' +
                '                        <th scope="col">Stock Sold</th>' +
                '                        <th scope="col">Breakeven / Share</th>' +
                '                        <th scope="col">P/L</th>' +
                '                        <th scope="col">%</th>' +
                '                        <th scope="col">Stock P/L</th>' +
                '                        <th scope="col">%</th>' +
                '                        <th scope="col">Total %</th>' +
                '                    </tr>' +
                '                </thead>' +
                '                <tbody>' +
                '                    ' +
                '                </tbody>' +
                '            </table>' +
                '        </div>' +
                '    </div>' +
                '</div>'
            );
            accordionTickers.splice(i + 1, 0, ticker);
            accordions[ticker] = prevAccordion.next();
        }
    }
    // Remove accordions for old tickers (if an item was removed)
    for (var i in accordionTickers) {
        var accordionTicker = accordionTickers[i];
        if (!(accordionTicker in stats)) {
            accordions[accordionTicker].remove();
        }
    }

    // Now we can fill in the tables
    // Start by removing all data
    $('#tradesAccordion tbody').find('*').remove();
    // Now add it back in!
    for (var i in stats.all) {
        var trade = stats.all[i];
        $('#trades-stats-all-table tbody').append(
            '<tr' + (trade.pl > 0 ? ' class="trade-table-profit-tr"' : (trade.pl < 0 ? ' class="trade-table-loss-tr"' : '')) + '>' +
            '    <td>' + trade.date + '</td>' +
            '    <td>' + (trade.buying ? 'Buy' : 'Sell') + '</td>' +
            '    <td>' + trade.ticker + '</td>' +
            '    <td>' + trade.qty.toString() + '</td>' +
            '    <td>' + getPriceText(trade.price) + '</td>' +
            '    <td>' + getPriceText(trade.totalBought) + '</td>' +
            '    <td>' + getPriceText(trade.totalSold) + '</td>' +
            '    <td>' + getPriceText(trade.pl) + '</td>' +
            '    <td>' + (trade.plPercent !== undefined ? trade.plPercent.toFixed(2) + ' %' : '-') + '</td>' +
            '    <td>' + getPriceText(trade.totalPL) + '</td>' +
            '    <td>' + (trade.totalPLPercent !== undefined ? trade.totalPLPercent.toFixed(2) + ' %' : '-') + '</td>' +
            '</tr>'
        );
    }
    for (var i in tickers) {
        var ticker = tickers[i];
        for (var j in stats[ticker]) {
            var trade = stats[ticker][j];
            $('#trades-stats-' + ticker + '-table tbody').append(
                '<tr' + (trade.pl > 0 ? ' class="rade-table-profit-tr"' : (trade.pl < 0 ? ' class="trade-table-loss-tr"' : '')) + '>' +
                '    <td>' + trade.date + '</td>' +
                '    <td>' + (trade.buying ? 'Buy' : 'Sell') + '</td>' +
                '    <td>' + trade.qty.toString() + '</td>' +
                '    <td>' + getPriceText(trade.price) + '</td>' +
                '    <td>' + getPriceText(trade.stockBought) + '</td>' +
                '    <td>' + getPriceText(trade.stockSold) + '</td>' +
                '    <td>' + getPriceText(trade.breakevenPerShare) + '</td>' +
                '    <td>' + getPriceText(trade.pl) + '</td>' +
                '    <td>' + (trade.plPercent !== undefined ? trade.plPercent.toFixed(2) + ' %' : '-') + '</td>' +
                '    <td>' + getPriceText(trade.stockPL) + '</td>' +
                '    <td>' + (trade.stockPLPercent !== undefined ? trade.stockPLPercent.toFixed(2) + ' %' : '-') + '</td>' +
                '    <td>' + (trade.totalPLPercent !== undefined ? trade.totalPLPercent.toFixed(2) + ' %' : '-') + '</td>' +
                '</tr>'
            );
        }
    }


    // Now we update the graphs
    updateGraphs();
}