$.fn.insertIndex = function(html, i) {
    if (i < $(this).children().length) {
        $(this).children().eq(i).before(html);
    } else {
        $(this).append(html);
    }
    return this;
};
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
function getOptionStr(trade, includeTicker = true) {
    return (includeTicker ? trade.ticker + ' ' : '') + trade.expiration + ' ' + trade.strike.toString() + (trade.isCall ? 'C' : 'P');
}
function getDateStr(date) {
    return (date.getMonth()+1).toString() + '/' + date.getDate().toString() + '/' + date.getFullYear().toString();
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
        if (window.localStorage.getItem("stockPrices")) {
            // stockPrices = JSON.parse(window.localStorage.getItem("stockPrices"));
        }
        if (window.localStorage.getItem('tradesTableSorting')) {
            var sorting = window.localStorage.getItem('tradesTableSorting');
            if (sorting === 'ascending') {
                tradeSortAscending = true;
            } else if (sorting === 'descending') {
                tradeSortAscending = false;
            }
        }
        updateTradeSorting();
        if (window.localStorage.getItem("trades")) {
            trades = JSON.parse(window.localStorage.getItem("trades"));
            trades.sort(function (a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime() });
            // sort is stable so same-day trades are still in the same order
            for (var i in trades) {
                if (!('isShares' in trades[i])) {
                    trades[i].isShares = true;
                }
                addTrade(trades[i], true);
            }
            saveTrades(); // If they needed to be updated
            updateStats();
        }
    } else {
        alert("Warning: localStorage not available on this browser.");
    }
};

function updateGraphs() {
    if (trades.length > 0) {
        var numShares = {};
        var tickerDateRanges = {};
        for (var i in trades) {
            var trade = trades[i];
            var tradeDate = new Date(trade.date);
            if (!(trade.ticker in numShares)) {
                numShares[trade.ticker] = 0;
                tickerDateRanges[trade.ticker] = { startDate: tradeDate, endDate: tradeDate };
            }
            numShares[trade.ticker] += trade.buying ? trade.qty : (-trade.qty);

            if (tradeDate < tickerDateRanges[trade.ticker].startDate) {
                tickerDateRanges[trade.ticker].startDate = tradeDate;
            }
            if (tradeDate > tickerDateRanges[trade.ticker].endDate) {
                tickerDateRanges[trade.ticker].endDate = tradeDate;
            }
        }
        var tickers = Object.keys(numShares);
        tickers.sort();
        for (var i in tickers) {
            if (numShares[tickers[i]] > 0) {
                tickerDateRanges[tickers[i]].endDate = getTodayDate();
            }
            if (minTradeDate === undefined || tickerDateRanges[tickers[i]].startDate < minTradeDate) {
                minTradeDate = tickerDateRanges[tickers[i]].startDate;
            }
            if (maxTradeDate === undefined || tickerDateRanges[tickers[i]].endDate > maxTradeDate) {
                maxTradeDate = tickerDateRanges[tickers[i]].endDate;
            }
        }

        var priceRequests = [];
        for (var i in tickers) {
            var request = {
                ticker: tickers[i],
                startDate: tickerDateRanges[tickers[i]].startDate,
                endDate: tickerDateRanges[tickers[i]].endDate
            };

            // If we already have the data, no need to request it
            var needRequest = true;
            if (tickers[i] in stockPrices) {
                var storedData = stockPrices[tickers[i]];
                var storedStartDate = new Date(storedData.startDate);
                var storedEndDate = new Date(storedData.endDate);
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
                $.getJSON("http://73.254.230.39:8123/ticker/" + request.ticker, function(data) {
                    console.log("Got historical data for " + request.ticker);
                    stockPrices[request.ticker] = data.data;
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
                updateStockGraphs(tickerDateRanges);
            }
        };
        if (priceRequests.length > 0) {
            // Need more historical data to create graphs
            getStockPrices(priceRequests);
        } else {
            // We already have all the historical data we need to create graphs
            updateStockGraphs(tickerDateRanges);
        }
    } else {
        updateStockGraphs(tickerDateRanges); // This will end up removing the accordion folds
    }
}
function getGraphData(tickerDateRanges) {
    var tickers = Object.keys(stockPrices);
    tickers.sort();

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
                if (date >= tickerDateRanges[ticker].startDate && new Date(stockPrices[ticker].startDate) <= date) {
                    // We have data for the current date
                    // Get the latest quote before or on the current date
                    var latestQuote;
                    var sharePriceIndex;
                    for (var j = 0; j < stockPrices[ticker].prices.length; j++) {
                        if (new Date(stockPrices[ticker].prices[j].date) <= date) {
                            latestQuote = stockPrices[ticker].prices[j];
                            sharePriceIndex = j;
                        } else {
                            break;
                        }
                    }
                    data[ticker].sharePriceIndex = sharePriceIndex;
                    var sharePrice = latestQuote;
                    sharePrice.t = new Date(latestQuote.date).getTime(); // need .t to show graphs of share price
                    data[ticker].sharePrice[0] = latestQuote;
                    data[ticker].dates[0] = date;
                }
            } else {
                // Do we have new data for this day?
                if (data[ticker].sharePriceIndex + 1 < stockPrices[ticker].prices.length && new Date(stockPrices[ticker].prices[data[ticker].sharePriceIndex+1].date).getTime() === date.getTime()
                    && date <= tickerDateRanges[ticker].endDate) {
                    data[ticker].sharePriceIndex++;
                    var sharePrice = stockPrices[ticker].prices[data[ticker].sharePriceIndex];
                    sharePrice.t = new Date(sharePrice.date).getTime(); // need .t to show graphs of share price
                    data[ticker].sharePrice.push(sharePrice);
                    data[ticker].dates.push(date);
                }
            }
        }
        var tradesOnDay = [];
        while (tradeIndex < trades.length && new Date(trades[tradeIndex].date).getTime() === date.getTime()) {
            tradesOnDay.push(trades[tradeIndex]);
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
            var pl = { o: 0, h: 0, l: 0, c: 0 };
            if (date !== data[ticker].dates[data[ticker].dates.length-1]) {
                // We don't have data for this stock on this date
                // It's either before first trade of this stock, after last trade, or a weekend (or other market holiday)
                if (data[ticker].pl.length > 0) {
                    // weekend or after last trade
                    // If it's a weekend, we can set pl anyway because allStat.totalPL won't be used, as there are no share prices
                    var lastClosePL = data[ticker].pl[data[ticker].pl.length-1].c;
                    pl = {
                        o: lastClosePL,
                        h: lastClosePL,
                        l: lastClosePL,
                        c: lastClosePL
                    };
                }
                // If before first trade, we have no profit/loss anyway.
            } else {
                anyStockHasPrice = true;

                var sharePrice = data[ticker].sharePrice[data[ticker].sharePrice.length-1];
                var holdings = {
                    t: sharePrice.t,
                    o: sharePrice.o * data[ticker].numShares,
                    h: sharePrice.h * data[ticker].numShares,
                    l: sharePrice.l * data[ticker].numShares,
                    c: sharePrice.c * data[ticker].numShares
                };
                data[ticker].holdings.push(holdings);
                data[ticker].breakevenPerShare.push({ x: date.getTime(), y: data[ticker].numShares > 0 ? ((data[ticker].bought - data[ticker].sold) / data[ticker].numShares) : 0 });
                pl = {
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
            }
            
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
        date = new Date(date.getTime() + 30*60*60*1000); // add 30 hours, so we're always part-way through the next day
        date = new Date(date.getFullYear(), date.getMonth(), date.getDate()); // Get start of day
    }

    // for (var i in tickers) {
    //     data[tickers[i]].sharePrice = stockPrices[tickers[i]].prices;
    // }

    data.all = allData;
    // Remove data for stocks entered and left all in one day
    // The graphs don't work with only one data point
    for (var i in tickers) {
        if (tickerDateRanges[tickers[i]].startDate.getTime() === tickerDateRanges[tickers[i]].endDate.getTime()) {
            delete data[tickers[i]];
        }
    }
    return data;
}
var graphData;
function updateStockGraphs(tickerDateRanges) {
    graphData = getGraphData(tickerDateRanges);
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
        }
    }
    chartTypeSelectionClicked(); // Act as if a button was pressed, to update all graphs

    // Now that we have stock prices, we can update positions as well
    processPositions();
}
var graphsAreOHLC = true;
function chartTypeSelectionClicked() {
    graphsAreOHLC = $('#ohlcButton').is(':checked');
    $("#stocksAccordion .accordion-body input").each(function() {
        $(this).attr('type', graphsAreOHLC ? 'radio' : 'checkbox');
    });
    // update all the graphs
    $('#stocksAccordion .accordion-item').each(function() {
        var graphContent = $(this).children('.accordion-collapse').first().attr('id');
        graphContent = graphContent.substring('stocks-accordion-'.length);
        chartElementSelectionClicked(graphContent);
    });
}
function chartElementSelectionClicked(graph) {
    var chart = charts[graph];
    var chartType;
    var datasets = [];
    var labels = [];
    if (graph === 'all') {
        chartType = graphsAreOHLC ? 'ohlc' : 'line';
        if ($('#holdingsButton-all').is(':checked')) {
            datasets.push(graphData['all'].holdings);
            labels.push("Total Holdings");
        }
        if ($('#plButton-all').is(':checked')) {
            datasets.push(graphData['all'].totalPL);
            labels.push("Total Profit/Loss");
        }
        if ($('#plPercentButton-all').is(':checked')) {
            datasets.push(graphData['all'].totalPLPercent);
            labels.push("Total Profit/Loss (%)");
        }
    } else {
        chartType = graphsAreOHLC ? 'ohlc' : 'line';
        if ($('#sharePriceButton-' + graph).is(':checked')) {
            datasets.push(graphData[graph].sharePrice);
            labels.push(graph + ' Share Price');
        }
        if ($('#holdingsButton-' + graph).is(':checked')) {
            datasets.push(graphData[graph].holdings);
            labels.push(graph + ' Holdings');
        }
        if ($('#breakevenButton-' + graph).is(':checked')) {
            chartType = 'line';
            datasets.push(graphData[graph].breakevenPerShare);
            labels.push(graph + ' Breakeven per Share');
        }
        if ($('#plButton-' + graph).is(':checked')) {
            datasets.push(graphData[graph].pl);
            labels.push(graph + ' Profit/Loss');
        }
        if ($('#plPercentButton-' + graph).is(':checked')) {
            datasets.push(graphData[graph].plPercent);
            labels.push(graph + ' Profit/Loss (%)');
        }
    }

    if (chart.config.type !== chartType) {
        var ctx = chart.ctx;
        chart.destroy();
        if (chartType === 'line') {
            for (var i in datasets) {
                var dataset = datasets[i];
                if (dataset[0].o) {
                    // it's OHLC data, so we need to convert
                    var newDataset = [];
                    for (var j in dataset) {
                        newDataset.push({ x: dataset[j].t, y: dataset[j].c });
                    }
                    datasets[i] = newDataset;
                }
            }
            var datasetsForChart = [];
            for (var i in datasets) {
                datasetsForChart.push({ label: labels[i], data: datasets[i] });
            }
            charts[graph] = chart = new Chart(ctx, {
                type: 'line',
                data: {
                    datasets: datasetsForChart
                },
                options: {
                    scales: Chart.defaults.financial.scales,
                    colorschemes: {
                        scheme: 'tableau.ClassicTrafficLight9'//'brewer.SetOne9'//'office.Celestial6'//'tableau.ClassicMedium10'
                    },
                    plugins: {
                        tooltip: {
                            intersect: false,
                            mode: 'index',
                            callbacks: {
                                label(ctx) {
                                    if (ctx.dataset.label.indexOf('%') === -1) {
                                        return ctx.dataset.label + ': ' + getPriceText(ctx.dataPoint.y);
                                    } else {
                                        return ctx.dataset.label + ': ' + ctx.dataPoint.y.toFixed(2) + ' %';
                                    }
                                }
                            }
                        }
                    }
                },
            });
        } else {
            // ohlc
            charts[graph] = chart = new Chart(ctx, {
                type: 'ohlc',
                data: {
                    datasets: [{
                        label: labels[0],
                        data: datasets[0]
                    }]
                }
            });
        }
    } else {
        if (chartType === 'line') {
            for (var i in datasets) {
                var dataset = datasets[i];
                if (dataset[0].o) {
                    // it's OHLC data, so we need to convert
                    var newDataset = [];
                    for (var j in dataset) {
                        newDataset.push({ x: dataset[j].t, y: dataset[j].c });
                    }
                    datasets[i] = newDataset;
                }
            }
        }
        var datasetsForChart = [];
        for (var i in datasets) {
            datasetsForChart.push({ label: labels[i], data: datasets[i] });
        }
        chart.data.datasets = datasetsForChart;
        chart.update();
    }
}

var editingTradeIndex = undefined;
function addTradeBtnClicked() {
    var optionRegex = /^([^ ]+) ((?:1|2|3|4|5|6|7|8|9|10|11|12)\/(?:1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|29|30|31)(?:\/(?:\d\d)?\d\d)?) (\d+(?:\.\d+)?)([CP])$/;

    var isShares = $('#sharesButton').is(':checked');
    var date = $('#tradeDate').val();
    var buying;
    if (isShares) {
        buying = $('#buyButton').is(':checked');
    } else {
        buying = $('#btoButton').is(':checked') || $('#btcButton').is(':checked');
    }
    var ticker = $('#tickerInput').val();
    var qty = $('#quantityInput').val();
    var price = $('#priceInput').val();

    var symbolValid = true;
    if (isShares) {
        symbolValid = !!ticker;
    } else {
        symbolValid = optionRegex.test(ticker);
    }
    if (symbolValid) {
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

    if (symbolValid && qty && price) {
        var trade = {
            isShares: isShares,
            date: date,
            buying: buying,
            ticker: ticker,
            qty: parseInt(qty),
            price: parseFloat(price)
        };
        if (!isShares) {
            trade.toOpen = $('#btoButton').is(':checked') || $('#stoButton').is(':checked');
            var regexGroups = optionRegex.exec(ticker);
            trade.ticker = regexGroups[1];
            trade.expiration = regexGroups[2];
            if (trade.expiration.length <= 5) {
                // doesn't have a year, so add current year
                // max without a year is "MM/DD" = 5 chars
                // min with a year is "M/D/YY" = 6 chars
                trade.expiration += '/' + (new Date().getFullYear() % 100).toString().padStart(2, '0');
            }
            trade.strike = parseFloat(regexGroups[3]);
            trade.isCall = regexGroups[4] === "C";
        }
        if (editingTradeIndex === undefined) {
            addTrade(trade, false);
        } else {
            updateTrade(editingTradeIndex, trade);
            editingTradeIndex = undefined;
        }

        $('#quantityInput').val('');
        $('#priceInput').val('');
        $('#tickerInput').removeClass('is-invalid');
        $('#quantityInput').removeClass('is-invalid');
        $('#priceInput').removeClass('is-invalid');

        $('#addTradeBtn').removeClass('btn-warning');
        $('#addTradeBtn').addClass('btn-primary');
        $('#addTradeBtn').html('<i class="bi bi-plus"></i>  Add Trade');
        $('#cancelTradeEditBtn').addClass('cancel-trade-edit-btn-not-displayed');
    }
}
function cancelTradeEditBtnClicked() {
    $('#quantityInput').val('');
    $('#priceInput').val('');
    $('#tickerInput').removeClass('is-invalid');
    $('#quantityInput').removeClass('is-invalid');
    $('#priceInput').removeClass('is-invalid');

    $('#addTradeBtn').removeClass('btn-warning');
    $('#addTradeBtn').addClass('btn-primary');
    $('#addTradeBtn').html('<i class="bi bi-plus"></i>  Add Trade');
    $('#cancelTradeEditBtn').addClass('cancel-trade-edit-btn-not-displayed');
}
function removeTradeBtnClicked(removeBtn) {
    var removeIndex = removeBtn.parentElement.parentElement.rowIndex - 1; // 0 is the header
    if (!tradeSortAscending) {
        removeIndex = trades.length - 1 - removeIndex;
    }
    removeTrade(removeIndex);
}

var tradeSortAscending = false;
function addTrade(trade, addingBulk) {
    var index = 0;
    var newTradeDateTime = new Date(trade.date).getTime();
    while (index < trades.length && new Date(trades[index].date).getTime() <= newTradeDateTime) {
        index++;
    }
    if (!addingBulk) {
        trades.splice(index, 0, trade);
        saveTrades();
    }
    var newRow = 
        '<tr class="trade-table-tr trade-table-' + (((trade.isShares && trade.buying) || (!trade.isShares && trade.toOpen)) ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
        '    <td>' + trade.date + '</td>' +
        '    <td>' + (trade.isShares ? (trade.buying ? 'Buy' : 'Sell') : ((trade.buying ? 'B' : 'S') + 'T' + (trade.toOpen ? 'O' : 'C'))) + '</td>' +
        '    <td>' + (trade.isShares ? trade.ticker : (trade.ticker + ' ' + trade.expiration + '<br/>' + trade.strike.toString() + (trade.isCall ? 'C' : 'P'))) + '</td>' +
        '    <td>' + trade.qty.toString() + '</td>' +
        '    <td>' + getPriceText(trade.price) + '</td>' +
        '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
        '</tr>';
    if (addingBulk) {
        // If adding in bulk, trades are already sorted when coming to this function
        if (tradeSortAscending) {
            $('#trades-table tbody').append(newRow);
        } else {
            $('#trades-table tbody').prepend(newRow);
        }
    } else {
        var rowIndex = tradeSortAscending ? index : (trades.length - 1 - index);
        $('#trades-table tbody').insertIndex(newRow, rowIndex);
    }

    if (!addingBulk) {
        updateStats();
    }
}
function updateTrade(index, newTrade) {
    if (trades[index].date !== newTrade.date) {
        removeTrade(index, true);
        addTrade(newTrade, false);
    } else {
        trades[index] = newTrade;
        saveTrades();
        var newRow = 
            '<tr class="trade-table-tr trade-table-' + (((newTrade.isShares && newTrade.buying) || (!newTrade.isShares && newTrade.toOpen)) ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
            '    <td>' + newTrade.date + '</td>' +
            '    <td>' + (newTrade.isShares ? (newTrade.buying ? 'Buy' : 'Sell') : ((newTrade.buying ? 'B' : 'S') + 'T' + (newTrade.toOpen ? 'O' : 'C'))) + '</td>' +
            '    <td>' + (newTrade.isShares ? newTrade.ticker : (newTrade.ticker + ' ' + newTrade.expiration + '<br/>' + newTrade.strike.toString() + (newTrade.isCall ? 'C' : 'P'))) + '</td>' +
            '    <td>' + newTrade.qty.toString() + '</td>' +
            '    <td>' + getPriceText(newTrade.price) + '</td>' +
            '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
            '</tr>';
        var rowIndex = tradeSortAscending ? index : (trades.length - 1 - index);
        $('#trades-table tbody').children().eq(rowIndex).replaceWith(newRow);
        updateStats();
    }
}
function removeTrade(index, updatingTrade = false) {
    var rowIndex = tradeSortAscending ? index : (trades.length - 1 - index);
    $('#trades-table tbody').find('tr').eq(rowIndex).remove();

    trades.splice(index, 1);
    saveTrades();

    if (!updatingTrade) {
        updateStats();
    }
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
    if (!tradeSortAscending) {
        editingTradeIndex = trades.length - 1 - editingTradeIndex;
    }

    var trade = trades[editingTradeIndex];
    $('#sharesButton').prop('checked', trade.isShares);
    $('#optionsButton').prop('checked', !trade.isShares);
    sharesOptionsSelectionChanged();
    $('#tradeDate').val(trade.date);
    if (trade.isShares) {
        $('#buyButton').prop('checked', trade.buying);
        $('#sellButton').prop('checked', !trade.buying);
    } else {
        $('#btoButton').prop('checked', trade.buying && trade.toOpen);
        $('#btcButton').prop('checked', trade.buying && !trade.toOpen);
        $('#stoButton').prop('checked', !trade.buying && trade.toOpen);
        $('#stcButton').prop('checked', !trade.buying && !trade.toOpen);
    }
    $('#tickerInput').val(trade.isShares ? trade.ticker : (trade.ticker + ' ' + trade.expiration + ' ' + trade.strike.toString() + (trade.isCall ? 'C' : 'P')));
    $('#quantityInput').val(trade.qty.toString());
    $('#priceInput').val(trade.price.toFixed(4));
    $('#tickerInput').removeClass('is-invalid');
    $('#quantityInput').removeClass('is-invalid');
    $('#priceInput').removeClass('is-invalid');

    $('#addTradeBtn').removeClass('btn-primary');
    $('#addTradeBtn').addClass('btn-warning');
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
                lots: {'shares':[]},
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

        var tradeValue = (trade.qty * trade.price) * (trade.isShares ? 1 : 100);
        var tradeBought = trade.buying ? tradeValue : 0;
        var tradeSold = !trade.buying ? tradeValue : 0;

        var stat = {
            date: trade.date,
            isShares: trade.isShares,
            buying: trade.buying,
            symbol: trade.isShares ? trade.ticker : getOptionStr(trade),
            qty: trade.qty,
            price: trade.price,
            stockBought: prevStockTrade.stockBought + tradeBought,
            stockSold: prevStockTrade.stockSold + tradeSold,
            totalBought: prevAllTrade.totalBought + tradeBought,
            totalSold: prevAllTrade.totalSold + tradeSold,
            lots: {}
        };
        var allStat = {
            date: trade.date,
            isShares: trade.isShares,
            buying: trade.buying,
            symbol: trade.isShares ? trade.ticker : getOptionStr(trade),
            qty: trade.qty,
            price: trade.price,
            totalBought: prevAllTrade.totalBought + tradeBought,
            totalSold: prevAllTrade.totalSold + tradeSold,
        };
        if (!trade.isShares) {
            stat.toOpen = allStat.toOpen = trade.toOpen;
            stat.expiration = allStat.expiration = trade.expiration;
            stat.strike = allStat.strike = trade.strike;
            stat.isCall = allStat.isCall = trade.isCall;
        }
        var prevLotKeys = Object.keys(prevStockTrade.lots);
        for (var key in prevLotKeys) {
            stat.lots[prevLotKeys[key]] = prevStockTrade.lots[prevLotKeys[key]].slice();
        }
        var pl;
        if (trade.isShares) {
            if (trade.buying) {
                pl = undefined;
                stat.lots.shares = stat.lots.shares.concat(new Array(trade.qty).fill(trade.price));
            } else {
                pl = 0;
                var soldLots = stat.lots.shares.splice(0, trade.qty);
                for (var l in soldLots) {
                    pl += trade.price - soldLots[l];
                }
            }

        } else {
            // Options!
            // If BTO or STC, it's a Long option (you bought it)
            // If STO or BTC, it's a Short option (you sold it)
            var option = (trade.buying === trade.toOpen ? 'Long ' : 'Short ') + getOptionStr(trade, false);
            if (trade.toOpen) {
                pl = undefined;
                if (!(option in stat.lots)) {
                    stat.lots[option] = [];
                }
                stat.lots[option] = stat.lots[option].concat(new Array(trade.qty).fill(trade.price));
            } else {
                // Closing
                pl = 0;
                var closedLots = stat.lots[option].splice(0, trade.qty);
                for (var l in closedLots) {
                    pl += trade.price - closedLots[l];
                }
                pl *= 100;
                if (trade.buying) {
                    pl = -pl; // E.g. STO @ 5, BTC @ 1 = 4 profit
                }
            }
        }
        stat.pl = pl;
        stat.plPercent = (stat.pl !== undefined && stat.stockBought > 0) ? (100*stat.pl/stat.stockBought) : undefined;
        stat.stockPL = (stat.pl === undefined) ? prevStockTrade.stockPL : ((prevStockTrade.stockPL === undefined ? 0 : prevStockTrade.stockPL) + stat.pl);
        stat.stockPLPercent = (stat.stockPL !== undefined && stat.stockBought > 0) ? (100*stat.stockPL/stat.stockBought) : undefined;
        stat.totalPL = (stat.pl === undefined) ? prevStockTrade.totalPL : ((prevStockTrade.totalPL === undefined ? 0 : prevStockTrade.totalPL) + stat.pl);
        stat.totalPLPercent = (stat.totalPL !== undefined && stat.totalBought > 0) ? (100*stat.totalPL/stat.totalBought) : undefined;
        
        allStat.pl = pl;
        allStat.plPercent = (allStat.pl !== undefined && allStat.totalBought > 0) ? (100*allStat.pl/allStat.totalBought) : undefined;
        allStat.totalPL = (allStat.pl === undefined) ? prevAllTrade.totalPL : ((prevAllTrade.totalPL === undefined ? 0 : prevAllTrade.totalPL) + allStat.pl);
        allStat.totalPLPercent = (allStat.totalPL !== undefined && allStat.totalBought > 0) ? (100*allStat.totalPL/allStat.totalBought) : undefined;

        stat.breakevenPerShare = stat.lots.shares.length > 0 ? ((stat.stockBought - stat.stockSold) / stat.lots.shares.length) : undefined;

        stats[trade.ticker].push(stat);
        allStats.push(allStat);

        prevTradesByTicker[trade.ticker] = stat;
        prevAllTrade = allStat;
    }
    // Now we need to check any open option positions for expiry
    // We need to find all of expired options, then sort by expiration date > ticker > long/short > call/put > strike
    // So that the "all" table is in the correct order
    var currentDateTime = new Date();
    var tickers = Object.keys(stats);
    tickers.sort();
    var expiredOptions = [];
    for (var i in tickers) {
        var ticker = tickers[i];
        var prevStockTrade = stats[ticker][stats[ticker].length - 1];
        for (var position in prevStockTrade.lots) {
            if (position !== 'shares' && prevStockTrade.lots[position].length > 0) {
                // Open option position
                var longOption = position.split(' ')[0] === 'Long';
                var expDateStr = position.split(' ')[1]; // E.g. "Long 4/16/21 300C" => "4/16/21"
                var strike = position.split(' ')[2];
                var isCall = strike[strike.length - 1] === 'C';
                strike = parseFloat(strike.substr(0, strike.length-1));

                var expiration = new Date("13:00:00 " + expDateStr);
                if (currentDateTime.getTime() >= expiration.getTime()) {
                    expiredOptions.push({
                        position: position,
                        ticker: ticker,
                        longOption: longOption,
                        expDateStr: expDateStr,
                        expiration: expiration,
                        strike: strike,
                        isCall: isCall
                    });
                }
            }
        }
    }
    // Sort by increasing strike
    expiredOptions.sort(function (a, b) { return a.strike - b.strike });
    // Then by call/put, calls first
    expiredOptions.sort(function (a, b) { if (a.isCall == b.isCall) { return 0; } else { return a.isCall ? -1 : 1 } });
    // Then by long/short, long first
    expiredOptions.sort(function (a, b) { if (a.longOption == b.longOption) { return 0; } else { return a.longOption ? -1 : 1 } });
    // Then by ticker
    expiredOptions.sort(function (a, b) { return a.ticker.localeCompare(b.ticker); });
    // Then by expiration date
    expiredOptions.sort(function (a, b) { return a.expiration.getTime() - b.expiration.getTime(); });

    for (var i in expiredOptions) {
        var position = expiredOptions[i].position;
        var ticker = expiredOptions[i].ticker;
        var longOption = expiredOptions[i].longOption;
        var expDateStr = expiredOptions[i].expDateStr;
        var strike = expiredOptions[i].strike;
        var isCall = expiredOptions[i].isCall;
        var prevStockTrade = stats[ticker][stats[ticker].length - 1];

        // Add a trade for this ticker, and in the overall stats
        var stat = {
            date: getDateStr(new Date(expDateStr)),
            isShares: false,
            buying: !longOption, // If long, it was BTO/STC, so the close is a Sell
            toOpen: false,
            expiration: expDateStr,
            strike: strike,
            isCall: isCall,
            isExpired: true,
            ticker: ticker,
            qty: prevStockTrade.lots[position].length,
            price: 0,
            stockBought: prevStockTrade.stockBought,
            stockSold: prevStockTrade.stockSold,
            totalBought: prevAllTrade.totalBought,
            totalSold: prevAllTrade.totalSold,
            lots: {}
        };
        var allStat = {
            date: getDateStr(new Date(expDateStr)),
            isShares: false,
            buying: !longOption,
            toOpen: false,
            expiration: expDateStr,
            strike: strike,
            isCall: isCall,
            isExpired: true,
            qty: prevStockTrade.lots[position].length,
            price: 0,
            totalBought: prevAllTrade.totalBought,
            totalSold: prevAllTrade.totalSold,
        };
        stat.symbol = allStat.symbol = getOptionStr(stat);
        var prevLotKeys = Object.keys(prevStockTrade.lots);
        for (var key in prevLotKeys) {
            stat.lots[prevLotKeys[key]] = prevStockTrade.lots[prevLotKeys[key]].slice();
        }

        var pl = 0;
        var expiredLots = stat.lots[position];
        stat.lots[position] = [];
        for (var l in expiredLots) {
            pl -= expiredLots[l];
        }
        pl *= 100;
        if (!longOption) {
            pl = -pl; // E.g. STO @ 5, BTC @ 1 = 4 profit
        }

        stat.pl = pl;
        stat.plPercent = (stat.pl !== undefined && stat.stockBought > 0) ? (100*stat.pl/stat.stockBought) : undefined;
        stat.stockPL = (stat.pl === undefined) ? prevStockTrade.stockPL : ((prevStockTrade.stockPL === undefined ? 0 : prevStockTrade.stockPL) + stat.pl);
        stat.stockPLPercent = (stat.stockPL !== undefined && stat.stockBought > 0) ? (100*stat.stockPL/stat.stockBought) : undefined;
        stat.totalPL = (stat.pl === undefined) ? prevStockTrade.totalPL : ((prevStockTrade.totalPL === undefined ? 0 : prevStockTrade.totalPL) + stat.pl);
        stat.totalPLPercent = (stat.totalPL !== undefined && stat.totalBought > 0) ? (100*stat.totalPL/stat.totalBought) : undefined;

        allStat.pl = pl;
        allStat.plPercent = (allStat.pl !== undefined && allStat.totalBought > 0) ? (100*allStat.pl/allStat.totalBought) : undefined;
        allStat.totalPL = (allStat.pl === undefined) ? prevAllTrade.totalPL : ((prevAllTrade.totalPL === undefined ? 0 : prevAllTrade.totalPL) + allStat.pl);
        allStat.totalPLPercent = (allStat.totalPL !== undefined && allStat.totalBought > 0) ? (100*allStat.totalPL/allStat.totalBought) : undefined;

        stat.breakevenPerShare = stat.lots.shares.length > 0 ? ((stat.stockBought - stat.stockSold) / stat.lots.shares.length) : undefined;

        stats[ticker].push(stat);
        allStats.push(allStat);

        prevTradesByTicker[ticker] = stat;
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
                '                        <th scope="col">Symbol</th>' +
                '                        <th scope="col">Qty</th>' +
                '                        <th scope="col">Price</th>' +
                '                        <th scope="col">Stock Bought</th>' +
                '                        <th scope="col">Stock Sold</th>' +
                '                        <th scope="col"># Shares</th>' +
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
            '    <th scope="row">' + trade.date + '</th>' +
            '    <th scope="row">' + (trade.isExpired ? 'EXP' : (trade.isShares ? (trade.buying ? 'Buy' : 'Sell') : ((trade.buying ? 'B' : 'S') + 'T' + (trade.toOpen ? 'O' : 'C')))) + '</th>' +
            '    <th scope="row">' + trade.symbol + '</th>' +
            '    <td>' + trade.qty.toString() + '</td>' +
            '    <td>' + getPriceText(trade.isExpired ? undefined : trade.price) + '</td>' +
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
                '<tr' + (trade.pl > 0 ? ' class="trade-table-profit-tr"' : (trade.pl < 0 ? ' class="trade-table-loss-tr"' : '')) + '>' +
                '    <th scope="row">' + trade.date + '</th>' +
                '    <th scope="row">' + (trade.isExpired ? 'EXP' : (trade.isShares ? (trade.buying ? 'Buy' : 'Sell') : ((trade.buying ? 'B' : 'S') + 'T' + (trade.toOpen ? 'O' : 'C')))) + '</th>' +
                '    <th scope="row">' + trade.symbol + '</th>' +
                '    <td>' + trade.qty.toString() + '</td>' +
                '    <td>' + getPriceText(trade.isExpired ? undefined : trade.price) + '</td>' +
                '    <td>' + getPriceText(trade.stockBought) + '</td>' +
                '    <td>' + getPriceText(trade.stockSold) + '</td>' +
                '    <td>' + trade.lots.shares.length.toString() + '</td>' +
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

function changeTradeSorting() {
    tradeSortAscending = !tradeSortAscending;
    updateTradeSorting();
}
function updateTradeSorting() {
    window.localStorage.setItem('tradesTableSorting', tradeSortAscending ? 'ascending' : 'descending');

    var rowHTML = [];
    $('#trades-table tbody tr').each(function() {
        rowHTML.splice(0, 0, $(this).html());
    });
    $('#trades-table tbody tr').each(function() {
        var html = rowHTML.splice(0, 1)[0];
        $(this).html(html);
    });

    if (tradeSortAscending) {
        $('#trade-sort-icon').removeClass('bi-caret-up-fill');
        $('#trade-sort-icon').addClass('bi-caret-down-fill');
    } else {
        $('#trade-sort-icon').removeClass('bi-caret-down-fill');
        $('#trade-sort-icon').addClass('bi-caret-up-fill');
    }
}

function sharesOptionsSelectionChanged() {
    var isShares = $('#sharesButton').is(':checked');

    $('#ticker-option-label').html(isShares ? 'Ticker' : 'Option');
    $('#tickerInput').attr('placeholder', isShares ? 'Ex: GME' : 'Ex: GME 4/16 180C');
    $('#quantity-unit-span').html(isShares ? 'Shares' : 'Contracts');
    $('#price-input-label').html(isShares ? 'Price' : 'Premium');
    if (isShares) {
        $('#buySellGroup-shares').removeClass('tradeActionGroup-not-displayed');
        $('#buySellGroup-options').addClass('tradeActionGroup-not-displayed');
    } else {
        $('#buySellGroup-options').removeClass('tradeActionGroup-not-displayed');
        $('#buySellGroup-shares').addClass('tradeActionGroup-not-displayed');
    }
}

function processPositions() {
    // The plan is to get a list of all open options, get their prices, and then finally compute all data for positions

    // Get open options
    var openOptions = getOpenOptions();

    // Get prices
    function getOptionData(tickers) {
        if (tickers.length > 0) {
            var ticker = tickers[0];
            $.getJSON("/options/" + ticker, function(data) {
                console.log("Got options data for " + ticker);
                processOptionsData(data);

                for (var position in openOptions[ticker]) {
                    var expDate = new Date(position.split(' ')[2]);
                    expDate = (expDate.getFullYear()-2000).toString().padStart(2, '0') + (expDate.getMonth()+1).toString().padStart(2, '0') + expDate.getDate().toString().padStart(2, '0');
                    
                    var strike = position.split(' ')[3];
                    var isCall = strike[strike.length-1] === 'C';
                    strike = strike.substr(0, strike.length - 1);

                    var optionData = isCall ? data.options[expDate][strike].c : data.options[expDate][strike].p;
                    openOptions[ticker][position].latestAsk = optionData.ask;
                    openOptions[ticker][position].latestBid = optionData.bid;
                    openOptions[ticker][position].delta = optionData.greeks.delta;
                    openOptions[ticker][position].theta = optionData.greeks.theta;
                }
                
                // Start on the rest of the requests
                getOptionData(tickers.slice(1));
            }).fail(function() {
                setTimeout(function() {
                    getOptionData(tickers);
                }, 2*1000); // Wait a couple seconds to request the data.
            });
        } else {
            // We got all the data we need!
            computeAndUpdatePositions(openOptions);
        }
    };
    if (Object.keys(openOptions).length > 0) {
        // Need more options data
        getOptionData(Object.keys(openOptions));
    } else {
        // There are no open options!
        computeAndUpdatePositions({});
    }
}
function getOpenOptions() {
    var positions = {};
    for (var i in trades) {
        var trade = trades[i];
        var ticker = trade.ticker;
        if (!(ticker in positions)) {
            positions[ticker] = { shares: 0 };
        }
        if (trade.isShares) {
            positions[ticker].shares = trade.buying ? (positions[ticker].shares + trade.qty) : (positions[ticker].shares - trade.qty);
        } else {
            // If BTO or STC, it's a Long option (you bought it)
            // If STO or BTC, it's a Short option (you sold it)
            var option = (trade.buying === trade.toOpen ? 'Long ' : 'Short ') + getOptionStr(trade);
            if (!(option in positions[ticker])) {
                positions[ticker][option] = 0;
            }
            positions[ticker][option] = trade.toOpen ? (positions[ticker][option] + trade.qty) : (positions[ticker][option] - trade.qty);
        }
    }

    var currentTime = new Date();
    var openOptions = {};
    for (var ticker in positions) {
        for (var position in positions[ticker]) {
            if (position !== 'shares' && positions[ticker][position] > 0) {
                var expirationTime = new Date(position.split(' ')[2] + ' 13:00:00');
                if (currentTime.getTime() >= expirationTime.getTime()) {
                    continue;
                }

                if (!(ticker in openOptions)) {
                    openOptions[ticker] = {};
                }
                openOptions[ticker][position] = { latestAsk: undefined, latestBid: undefined, delta: undefined, theta: undefined };
            }
        }
    }
    return openOptions;
}
function computeAndUpdatePositions(latestOptionPrices) {
    // Per position:
    // Symbol | Qty | Breakeven | Market Price | Total Value | Realized P/L | Unrealized P/L | Total P/L | % of Ticker Bought | Delta | Theta
    var latestSharePrices = {};
    var positions = {};
    var openOptions = []; // Running list of open options with expiration dates
    var lots = {};
    var tickerBought = {};
    var tickerSold = {};

    var tradesWithExp = trades.slice();
    var lastProcessedTradeDate = new Date(tradesWithExp[0].date);
    var currentTime = new Date();
    for (var i = 0; i <= tradesWithExp.length; i++) {
        // If i is tradesWithExp.length, we're after the end of trades, and just looking for expired options after the last trade
        if (i === tradesWithExp.length || new Date(tradesWithExp[i].date).getTime() > lastProcessedTradeDate.getTime()) {
            // Next trade is on a later date, so check for expirations in between last trade and this one
            for (var j in openOptions) {
                var expiration = new Date(openOptions[j].expiration + ' 13:00:00');
                if (expiration.getTime() >= lastProcessedTradeDate.getTime() && 
                    (
                        (i === tradesWithExp.length && expiration.getTime() <= currentTime.getTime()) ||
                        (i < tradesWithExp.length && expiration.getTime() < new Date(tradesWithExp[i].date).getTime())
                    )
                ) {
                    // Expire it
                    var option = openOptions[j];
                    var expTrade = {
                        isShares: false,
                        date: option.expiration,
                        buying: !option.isLong,
                        toOpen: false,
                        ticker: option.ticker,
                        expiration: option.expiration,
                        strike: option.strike,
                        isCall: option.isCall,
                        qty: option.qty,
                        price: 0,
                    };
                    tradesWithExp.splice(i, 0, expTrade);
                }
            }
        }
        if (i === tradesWithExp.length) {
            break;
        }

        var trade = tradesWithExp[i];
        var ticker = trade.ticker;
        // Get the starting data in if we haven't seen this ticker/position before
        if (!(ticker in positions)) {
            latestSharePrices[ticker] = stockPrices[ticker].prices[stockPrices[ticker].prices.length - 1].c;
            positions[ticker] = {
                total: {
                    symbol: ticker,
                    qty: undefined,
                    breakeven: undefined,
                    marketPrice: undefined,
                    totalValue: 0,
                    realizedPL: 0,
                    unrealizedPL: 0,
                    totalPL: 0,
                    totalPLPercent: 0,
                    delta: 0,
                    theta: 0
                }
            };
            lots[ticker] = { };
            tickerBought[ticker] = { total: 0 };
            tickerSold[ticker] = { total: 0 };
        }
        if (trade.isShares) {
            if (!('shares' in positions[ticker])) {
                positions[ticker].shares = {
                    symbol: ticker,
                    qty: 0,
                    breakeven: 0,
                    marketPrice: 0,
                    totalValue: 0,
                    realizedPL: 0,
                    unrealizedPL: 0,
                    totalPL: 0,
                    totalPLPercent: 0,
                    delta: 0,
                    theta: undefined
                };
                lots[ticker].shares = [];
                tickerBought[ticker].shares = 0;
                tickerSold[ticker].shares = 0;
            }
        } else {
            var option = (trade.buying === trade.toOpen ? 'Long ' : 'Short ') + getOptionStr(trade);
            if (!(option in positions[ticker])) {
                positions[ticker][option] = {
                    symbol: option,
                    qty: 0,
                    breakeven: 0,
                    marketPrice: 0,
                    totalValue: 0,
                    realizedPL: 0,
                    unrealizedPL: 0,
                    totalPL: 0,
                    totalPLPercent: 0,
                    delta: 0,
                    theta: 0
                };
                lots[ticker][option] = [];
                tickerBought[ticker][option] = 0;
                tickerSold[ticker][option] = 0;
            }
        }

        // And now start processing the trade
        if (trade.isShares) {
            if (trade.buying) {
                lots[ticker].shares = lots[ticker].shares.concat(new Array(trade.qty).fill(trade.price));
                tickerBought[ticker].total += trade.qty * trade.price;
                tickerBought[ticker].shares += trade.qty * trade.price;

                positions[ticker].shares.qty += trade.qty;
            } else {
                tickerSold[ticker].total += trade.qty * trade.price;
                tickerSold[ticker].shares += trade.qty * trade.price;
                var pl = 0;
                var soldLots = lots[ticker].shares.splice(0, trade.qty);
                for (var l in soldLots) {
                    pl += trade.price - soldLots[l];
                }

                positions[ticker].shares.qty -= trade.qty;
                positions[ticker].shares.realizedPL += pl;
            }

        } else {
            // Options!
            // If BTO or STC, it's a Long option (you bought it)
            // If STO or BTC, it's a Short option (you sold it)
            var option = (trade.buying === trade.toOpen ? 'Long ' : 'Short ') + getOptionStr(trade);
            if (trade.buying) {
                tickerBought[ticker].total += trade.qty * trade.price * 100;
                tickerBought[ticker][option] += trade.qty * trade.price * 100;
            } else {
                tickerSold[ticker].total += trade.qty * trade.price * 100;
                tickerSold[ticker][option] += trade.qty * trade.price * 100;
            }
            if (trade.toOpen) {
                lots[ticker][option] = lots[ticker][option].concat(new Array(trade.qty).fill(trade.price));

                positions[ticker][option].qty += trade.qty;

                var newOption = {
                    ticker: ticker,
                    isLong: trade.buying === trade.toOpen,
                    expiration: trade.expiration,
                    strike: trade.strike,
                    isCall: trade.isCall,
                    qty: trade.qty
                };
                openOptions.push(newOption);
            } else {
                // Closing
                var pl = 0;
                var closedLots = lots[ticker][option].splice(0, trade.qty);
                for (var l in closedLots) {
                    pl += trade.price - closedLots[l];
                }
                pl *= 100;
                if (trade.buying) {
                    pl = -pl; // E.g. STO @ 5, BTC @ 1 = 4 profit
                }

                positions[ticker][option].qty -= trade.qty;
                positions[ticker][option].realizedPL += pl;

                // Find the option record in the open options
                var optIndex;
                for (var j in openOptions) {
                    var opt = openOptions[j];
                    // If we're STC, we're closing a long option, and if BTC, closing a short option
                    if (opt.ticker === ticker && opt.isLong === !trade.buying && opt.expiration === trade.expiration && opt.strike === trade.strike && opt.isCall === trade.isCall) {
                        optIndex = j;
                        break;
                    }
                }
                // Then remove quantity, and if it's closed, remove it from the list
                openOptions[optIndex].qty -= trade.qty;
                if (openOptions[optIndex].qty === 0) {
                    openOptions.splice(optIndex, 1);
                }
            }
        }
        
        lastProcessedTradeDate = new Date(trade.date);
    }

    for (var ticker in positions) {
        var position = positions[ticker];
        var latestSharePrice = latestSharePrices[ticker];
        var optionPrices = latestOptionPrices[ticker];
        var positionOpenOptions = [];
        for (var i in openOptions) {
            if (openOptions[i].ticker === ticker) {
                positionOpenOptions.push(openOptions[i]);
            }
        }
        var tickerLots = lots[ticker];
        var bought = tickerBought[ticker];
        var sold = tickerSold[ticker];

        // Total: +totalValue, realizedPL, +unrealizedPL, +totalPL, +totalPLPercent, +delta, +theta
        // Shares, Options: qty, +breakeven, +marketPrice, +totalValue, realizedPL, +unrealizedPL, +totalPL, +totalPLPercent, +delta, +theta (not for shares)
        if ('shares' in position) {
            position.shares.breakeven = (bought.shares - sold.shares) / position.shares.qty;
            position.shares.marketPrice = latestSharePrice;
            position.shares.totalValue = position.shares.marketPrice * position.shares.qty;
            position.shares.unrealizedPL = 0;
            for (var i in tickerLots.shares) {
                position.shares.unrealizedPL += position.shares.marketPrice - tickerLots.shares[i];
            }
            position.shares.totalPL = position.shares.realizedPL + position.shares.unrealizedPL;
            position.shares.totalPLPercent = position.shares.totalPL / bought.shares * 100;
            position.shares.delta = position.shares.qty;

            if (position.shares.qty > 0) {
                position.total.totalValue += position.shares.totalValue;
                position.total.realizedPL += position.shares.realizedPL;
                position.total.unrealizedPL += position.shares.unrealizedPL;
                position.total.totalPL += position.shares.totalPL;
                position.total.delta += position.shares.delta;
            }
        }
        for (var option in position) {
            if (option === 'total' || option === 'shares') {
                continue;
            }

            position[option].breakeven = (bought[option] - sold[option]) / position[option].qty;
            // If this is a closed option, we won't have a price for it
            position[option].marketPrice = (optionPrices && option in optionPrices) ? ((option.startsWith("Long") ? optionPrices[option].latestBid : optionPrices[option].latestAsk)) : NaN;
            position[option].totalValue = isNaN(position[option].marketPrice) ? 0 : (position[option].marketPrice * position[option].qty * 100);
            position[option].unrealizedPL = 0;
            for (var i in tickerLots[option]) {
                position[option].unrealizedPL += (position[option].marketPrice - tickerLots[option][i]) * 100;
            }
            position[option].totalPL = position[option].realizedPL + position[option].unrealizedPL;
            position[option].totalPLPercent = position[option].totalPL / bought[option] * 100;
            // If this is a closed option, we won't have greeks for it
            position[option].delta = (optionPrices && option in optionPrices) ? (optionPrices[option].delta * 100 * position[option].qty) : NaN;
            position[option].theta = (optionPrices && option in optionPrices) ? (optionPrices[option].theta * 100 * position[option].qty) : NaN;

            if (position[option].qty > 0) {
                position.total.totalValue += position[option].totalValue;
                position.total.realizedPL += position[option].realizedPL;
                position.total.unrealizedPL += position[option].unrealizedPL;
                position.total.totalPL += position[option].totalPL;
                if (!isNaN(position[option].delta)) {
                    if (option.startsWith("Long")) {
                        position.total.delta += position[option].delta;
                    } else {
                        position.total.delta -= position[option].delta;
                    }
                }
                if (!isNaN(position[option].theta)) {
                    if (option.startsWith("Long")) {
                        position.total.theta += position[option].theta;
                    } else {
                        position.total.theta -= position[option].theta;
                    }
                }
            }
        }

        position.total.breakeven = ('shares' in position && position.shares.qty > 0) ? ((bought.total - sold.total) / position.shares.qty) : undefined;
        position.total.totalPLPercent = position.total.totalPL / bought.total * 100;
    }

    var openPositions = {};
    var closedPositions = {};
    for (var ticker in positions) {
        var isOpen = false;
        for (var security in positions[ticker]) {
            if (security !== 'total' && positions[ticker][security].qty > 0) {
                isOpen = true;
                break;
            }
        }
        if (isOpen) {
            openPositions[ticker] = positions[ticker];
        } else {
            closedPositions[ticker] = positions[ticker];
        }
    }
    for (var ticker in openPositions) {
        var position = openPositions[ticker];
        var partiallyClosed = false;
        for (var security in position) {
            if (security !== 'total' && position[security].qty === 0) {
                partiallyClosed = true;
                break;
            }
        }
        if (!partiallyClosed) {
            continue;
        }
        
        position.totalFromClosed = {
            symbol: ticker,
            realizedPL: 0,
            totalPLPercent: undefined
        };
        for (var security in position) {
            if (security !== 'total' && position[security].qty === 0) {
                position.totalFromClosed.realizedPL += position[security].realizedPL;
            }
        }
        position.totalFromClosed.totalPLPercent = position.totalFromClosed.realizedPL / tickerBought[ticker].total * 100;
    }
    for (var ticker in closedPositions) {
        var position = closedPositions[ticker];
        for (var security in position) {
            if (security !== 'total') {
                position.total.realizedPL += position[security].realizedPL;
            }
        }
        position.total.totalPL = position.total.realizedPL;
        position.total.totalPLPercent = position.total.totalPL / tickerBought[ticker].total * 100;
    }

    var summaries = {
        open: {
            totalValue: 0,
            realizedPL: 0,
            unrealizedPL: 0,
            totalPL: 0,
            totalPLPercent: undefined,
            theta: 0
        },
        closed: {
            totalPL: 0,
            totalPLPercent: undefined
        },
        all: {
            totalValue: 0,
            realizedPL: 0,
            unrealizedPL: 0,
            totalPL: 0,
            totalPLPercent: undefined,
            theta: 0
        }
    };

    var totalOpenBought = 0;
    for (var ticker in openPositions) {
        var total = openPositions[ticker].total;
        summaries.open.totalValue += total.totalValue;
        summaries.open.realizedPL += total.realizedPL;
        summaries.open.unrealizedPL += total.unrealizedPL;
        summaries.open.totalPL += total.totalPL;
        summaries.open.theta += total.theta;
        totalOpenBought += tickerBought[ticker].total;
    }
    summaries.open.totalPLPercent = summaries.open.totalPL / totalOpenBought * 100;

    var totalClosedBought = 0;
    for (var ticker in openPositions) {
        var partiallyClosed = false;
        var position = openPositions[ticker];
        for (var security in position) {
            if (security !== 'total' && security !== 'totalFromClosed' && position[security].qty === 0) {
                partiallyClosed = true;
                break;
            }
        }
        if (partiallyClosed) {
            totalClosedBought += tickerBought[ticker].total;
            summaries.closed.totalPL += position.totalFromClosed.realizedPL;
        }
    }
    for (var ticker in closedPositions) {
        summaries.closed.totalPL += closedPositions[ticker].total.totalPL;
    }
    summaries.closed.totalPLPercent = summaries.closed.totalPL / totalClosedBought * 100;

    var totalBought = 0;
    for (var ticker in positions) {
        var total = positions[ticker].total;
        summaries.all.totalValue += total.totalValue;
        summaries.all.realizedPL += total.realizedPL;
        summaries.all.unrealizedPL += total.unrealizedPL;
        summaries.all.totalPL += total.totalPL;
        summaries.all.theta += total.theta;
        totalBought += tickerBought[ticker].total;
    }
    summaries.all.totalPLPercent = summaries.all.totalPL / totalBought * 100;

    updatePositionsTable(summaries, openPositions, closedPositions);
}
function updatePositionsTable(summaries, openPositions, closedPositions) {
    $('#open-positions-table tbody').children().remove();
    $('#closed-positions-table tbody').children().remove();

    var openTickers = Object.keys(openPositions);
    openTickers.sort();
    for (var i in openTickers) {
        var ticker = openTickers[i];
        var position = openPositions[ticker];

        // Symbol | Qty | Breakeven | Market Price | Total Value | Realized P/L | Unrealized P/L | Total P/L | % of Ticker Bought | Delta | Theta
        // Header Row:
        // Ticker | -- | Total Breakeven per Share | -- | Total Value | Realized P/L | Unrealized P/L | Total P/L | % of Ticker Bought | Delta | Theta 
        // Shares Row:
        // Ticker | # Shares | Breakeven per Share | Share Price | Total Share Value | Realized P/L | Unrealized P/L | Total P/L | % of Ticker Bought | Delta | -- 
        // Options Row:
        // Ticker | # Contracts | Breakeven per Contract | Contract Price | Total Contract Value | Realized P/L | Unrealized P/L | Total P/L | % of Ticker Bought | Delta | Theta 
        var headerRow =
            '<tr class="table-info">' +
            '    <th scope="row">' + ticker + '</th>' +
            '    <td></td>' +
            '    <td>' + (position.total.breakeven === undefined ? '--' : (getPriceText(position.total.breakeven) + '/sh')) + '</td>' +
            '    <td></td>' +
            '    <td>' + getPriceText(position.total.totalValue) + '</td>' +
            '    <td>' + getPriceText(position.total.realizedPL) + '</td>' +
            '    <td>' + getPriceText(position.total.unrealizedPL) + '</td>' +
            '    <td>' + getPriceText(position.total.totalPL) + '</td>' +
            '    <td>' + (position.total.totalPLPercent !== Infinity ? position.total.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
            '    <td>' + position.total.delta.toFixed(1) + '</td>' +
            '    <td>' + (position.total.theta === 0 ? '--' : position.total.theta.toFixed(1)) + '</td>' +
            '</tr>';
        $('#open-positions-table tbody').append(headerRow);
        if ('shares' in position && position.shares.qty > 0) {
            var sharesRow = 
                '<tr>' +
                '    <th scope="row"><i class="bi bi-caret-right-fill"></i>  ' + ticker + '</th>' +
                '    <td>' + position.shares.qty.toString() + '</td>' +
                '    <td>' + getPriceText(position.shares.breakeven) + '/sh' + '</td>' +
                '    <td>' + getPriceText(position.shares.marketPrice) + '</td>' +
                '    <td>' + getPriceText(position.shares.totalValue) + '</td>' +
                '    <td>' + getPriceText(position.shares.realizedPL) + '</td>' +
                '    <td>' + getPriceText(position.shares.unrealizedPL) + '</td>' +
                '    <td>' + getPriceText(position.shares.totalPL) + '</td>' +
                '    <td>' + (position.shares.totalPLPercent !== Infinity ? position.shares.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
                '    <td>' + position.shares.delta.toFixed(1) + '</td>' +
                '    <td>' + '--' + '</td>' +
                '</tr>';
            $('#open-positions-table tbody').append(sharesRow);
        }
        for (var option in position) {
            if (option === 'total' || option === 'totalFromClosed' || option === 'shares' || position[option].qty === 0) {
                continue;
            }

            var symbol = option;
            if (symbol.startsWith("Long ")) {
                symbol = symbol.substr("Long ".length);
            }
            var optionRow = 
                '<tr>' +
                '    <th scope="row"><i class="bi bi-caret-right-fill"></i>  ' + symbol + '</th>' +
                '    <td>' + position[option].qty.toString() + '</td>' +
                '    <td>' + getPriceText(position[option].breakeven) + '/opt' + '</td>' +
                '    <td>' + getPriceText(position[option].marketPrice) + '</td>' +
                '    <td>' + getPriceText(position[option].totalValue) + '</td>' +
                '    <td>' + getPriceText(position[option].realizedPL) + '</td>' +
                '    <td>' + getPriceText(position[option].unrealizedPL) + '</td>' +
                '    <td>' + getPriceText(position[option].totalPL) + '</td>' +
                '    <td>' + (position[option].totalPLPercent !== Infinity ? position[option].totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
                '    <td>' + (isNaN(position[option].delta) ? '??' : position[option].delta.toFixed(1)) + '</td>' +
                '    <td>' + (isNaN(position[option].theta) ? '??' : position[option].theta.toFixed(1)) + '</td>' +
                '</tr>';
            $('#open-positions-table tbody').append(optionRow);
        }
    }
    var openPositionsFooterRow =
        '<tr class="table-primary">' +
        '    <th scope="row">Total:</th>' +
        '    <th scope="row"></th>' +
        '    <th scope="row"></th>' +
        '    <th scope="row"></th>' +
        '    <th scope="row">' + getPriceText(summaries.open.totalValue) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.open.realizedPL) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.open.unrealizedPL) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.open.totalPL) + '</th>' +
        '    <th scope="row">' + (summaries.open.totalPLPercent !== Infinity ? summaries.open.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</th>' +
        '    <th scope="row"></th>' +
        '    <th scope="row">' + (summaries.open.theta === 0 ? '--' : summaries.open.theta.toFixed(1)) + '</th>' +
        '</tr>';
    $('#open-positions-table tbody').append(openPositionsFooterRow);

    var closedTickers = [];
    for (var i in openTickers) {
        var ticker = openTickers[i];
        var position = openPositions[ticker];
        for (var security in position) {
            if (security !== 'total' && position[security].qty === 0) {
                closedTickers.push(ticker);
                break;
            }
        }
    }
    closedTickers = closedTickers.concat(Object.keys(closedPositions));
    closedTickers.sort();
    for (var i in closedTickers) {
        var ticker = closedTickers[i];
        var fullyClosed = ticker in closedPositions;
        var position = fullyClosed ? closedPositions[ticker] : openPositions[ticker];

        var totals = fullyClosed ? position.total : position.totalFromClosed;

        var numClosedSecurities = 0;
        for (var security in position) {
            if (position !== 'total' && position !== 'totalFromClosed' && position[security].qty === 0) {
                numClosedSecurities++;
            }
        }
        var needsSubRows = numClosedSecurities > 1;

        // Symbol | Realized P/L | % of Ticker Bought
        var headerSymbol = ticker;
        if (!needsSubRows) {
            for (var security in position) {
                if (position !== 'total' && position !== 'totalFromClosed' && position[security].qty === 0) {
                    if (security === 'shares') {
                        headerSymbol = ticker;
                    } else {
                        headerSymbol = security;
                        if (headerSymbol.startsWith("Long ")) {
                            headerSymbol = headerSymbol.substr("Long ".length);
                        }
                    }
                    break;
                }
            }
        }
        var headerRow =
            '<tr class="table-info">' +
            '    <th scope="row">' + headerSymbol + '</th>' +
            '    <td>' + getPriceText(totals.realizedPL) + '</td>' +
            '    <td>' + (totals.totalPLPercent !== Infinity ? totals.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
            '</tr>';
        $('#closed-positions-table tbody').append(headerRow);
        if (needsSubRows) {
            if ('shares' in position && position.shares.qty == 0) {
                var sharesRow = 
                    '<tr>' +
                    '    <th scope="row"><i class="bi bi-caret-right-fill"></i>  ' + ticker + '</th>' +
                    '    <td>' + getPriceText(position.shares.realizedPL) + '</td>' +
                    '    <td>' + (position.shares.totalPLPercent !== Infinity ? position.shares.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
                    '</tr>';
                $('#closed-positions-table tbody').append(sharesRow);
            }
            for (var option in position) {
                if (option === 'total' || option === 'totalFromClosed' || option === 'shares' || position[option].qty > 0) {
                    continue;
                }

                var symbol = option;
                if (symbol.startsWith("Long ")) {
                    symbol = symbol.substr("Long ".length);
                }
                var optionRow = 
                    '<tr>' +
                    '    <th scope="row"><i class="bi bi-caret-right-fill"></i>  ' + symbol + '</th>' +
                    '    <td>' + getPriceText(position[option].realizedPL) + '</td>' +
                    '    <td>' + (position[option].totalPLPercent !== Infinity ? position[option].totalPLPercent.toFixed(2) + ' %' : '∞%') + '</td>' +
                    '</tr>';
                $('#closed-positions-table tbody').append(optionRow);
            }
        }
    }
    var closedPositionsFooterRow =
        '<tr class="table-primary">' +
        '    <th scope="row">Total:</th>' +
        '    <th scope="row">' + getPriceText(summaries.closed.totalPL) + '</th>' +
        '    <th scope="row">' + (summaries.closed.totalPLPercent !== Infinity ? summaries.closed.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</th>' +
        '</tr>';
    $('#closed-positions-table tbody').append(closedPositionsFooterRow);

    var summaryRow = 
        '<tr class="table-primary">' +
        '    <th scope="row">' + getPriceText(summaries.all.totalValue) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.all.realizedPL) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.all.unrealizedPL) + '</th>' +
        '    <th scope="row">' + getPriceText(summaries.all.totalPL) + '</th>' +
        '    <th scope="row">' + (summaries.all.totalPLPercent !== Infinity ? summaries.all.totalPLPercent.toFixed(2) + ' %' : '∞%') + '</th>' +
        '    <th scope="row">' + (summaries.all.theta === 0 ? '--' : summaries.all.theta.toFixed(1)) + '</th>' +
        '</tr>';
    $('#summary-positions-table tbody').html(summaryRow);
}

function processOptionsData(optionData) {
    var rates = {
        oneMo:   optionData.rates["1m"],
        threeMo: optionData.rates["3m"],
        sixMo:   optionData.rates["6m"],
        oneYr:   optionData.rates["1yr"],
        twoYr:   optionData.rates["2yr"]
    };

    var CALL = 1;
    var PUT = 2;

    function bisect(t, e, n, unknown1, unknown2) {
        // t = bisect function
        // e = 0
        // n = 2000
        // unknown1 = 0.01
        // unknown2 = 30
        var r = {
            Max: 1,
            Min: 2,
            Zero: 0
        };
        var arguments = [t, e, n, unknown1, unknown2];
        var i = arguments.length > 3 && void 0 !== arguments[3] ? arguments[3] : 0.001;
        var a = arguments.length > 4 && void 0 !== arguments[4] ? arguments[4] : 30;
        var o = arguments.length > 5 && void 0 !== arguments[5] ? arguments[5] : r.Zero;
        if (i <= 0 || a < 1) throw new Error;
        if (e > n) throw new Error('Left must be less than right');
        for (var u = 0; u <= a; ) {
            u++;
            var s = (e + n) / 2;
            if ((n - e) / 2 < i)
                return s;
            var l = t(s);
            var c = t(e);
            (o === r.Zero && Math.sign(c) === Math.sign(l) || o === r.Min && l < c || o === r.Max && l > c) ? e = s : n = s;
        }
        return e;
    }
    function d1(t, e, n, r, i) {
        // t = last underlying price
        // e = strike price
        // n = rate / 100
        // r = 0 (volatility?)
        // i = time to expiration in years
        return (Math.log(t / e) + (n + r * r / 2) * i) / (r * Math.sqrt(i));
    }
    function d2(t, e, n) {
        // t = d1 return value
        // e = 0 (volatility?)
        // n = time to expiration in years
        return t - e * Math.sqrt(n);
    }
    function cnd(t) {
        if (t < 0) return 1 - cnd( - t);
        var e = 1 / (1 + 0.2316419 * t);
        return 1 - Math.exp( - t * t / 2) / Math.sqrt(2 * Math.PI) * e * (0.31938153 + e * (e * (1.781477937 + e * (1.330274429 * e - 1.821255978)) - 0.356563782));
    }
    function getPrice(t, e, n, r, i, a) {
        // t = 1 for CALL, 2 for PUT
        // e = last underlying price
        // n = strike price
        // r = time to expiration in years
        // i = rate / 100
        // a = 0 (volatility?)
        var assumedVolatilityIfNaN;
        Number.isNaN(a) && (a = assumedVolatilityIfNaN);
        var o = d1(e, n, i, a, r);
        var u = d2(o, a, r);
        return t === CALL ? (e*cnd(o) - n*Math.exp(-i*r)*cnd(u)) : (n*Math.exp(-i*r)*cnd(-u) - e*cnd(-o));
    }
    function getIv2(t, e, n, r, i, a) {
        // t = 1 for CALL, 2 for PUT
        // e = bid-ask midpoint
        // n = last underlying price
        // r = strike price
        // i = time to expiration in years
        // a = rate / 100
        var u = getPrice(t, n, r, i, a, 0);
        return e < u ? NaN : bisect(function (u) {
            return getPrice(t, n, r, i, a, u / 100) - e;
        }, 0, 2000, 0.01, 30) / 100;
    }
    function getRate(t, rates) {
        // t = time to expiration in days
        var e = 365 / 12;
        return t <= (e + 91.25) / 2 ? rates.oneMo : t <= 136.875 ? rates.threeMo : t <= 273.75 ? rates.sixMo : t <= 547.5 ? rates.oneYr : rates.twoYr;
    }
    function getIv(t, e, n, r, i, a) {
        // t = bid-ask midpoint
        // e = 1 for CALL, 2 for PUT
        // n = expiration date object (at market close)
        // r = strike price
        // i = last underlying price
        // a = risk-free interest rates object

        var o = (n.getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24; // time to expiration in days
        var u = o / 365; // time to expiration in years
        var s = getRate(o, a);
        return getIv2(e, t, i, r, u, s / 100);
    }
    function stdpdf(t) {
        return Math.exp( - Math.pow(t, 2) / 2) / 2.5066282746310002;
    }
    function getGreeks2(t, e, n, r, i, a) {
        // t = 1 for CALL, 2 for PUT
        // e = last underlying price
        // n = expiration datetime object (at market close)
        // r = time to expiration in years
        // i = rate / 100
        // a = volatility
        var o = d1(e, n, i, a, r);
        var u = d2(o, a, r);
        var s = cnd(o);
        var l = stdpdf(o);
        var c = Math.sqrt(r);
        var v = Math.exp(-i*r);
        var y = {
            delta: 0,
            theta: 0,
            rho: 0,
            gamma: 0,
            vega: 0
        };
        var p = -e*l*a / (2*c);
        var g = i*n*v;
        if (t === CALL) {
            var b = cnd(u);
            y.delta = s;
            y.theta = (p - g*b) / 365;
            y.rho = n*r*v*b / 100;
        } else {
            var S = cnd(-u);
            y.delta = s - 1;
            y.theta = (p + g*S) / 365;
            y.rho = -n*r*v*S / 100;
        }
        y.gamma = l / (e*a*c);
        y.vega = e*l*c / 100;
        return y;
    }
    function getGreeks(t, e, n, r, i, a, o) {
        // t = bid-ask midpoint
        // e = 1 for CALL, 2 for PUT
        // n = expiration datetime object (at market close)
        // r = strike price
        // i = last underlying price
        // a = risk-free interest rates object
        // o = volatility
        var u = (n.getTime() - new Date().getTime()) / 1000 / 60 / 60 / 24; // time to expiration in days
        var s = u / 365; // time to expiration in years
        var l = getRate(u, a);
        return getGreeks2(e, i, r, s, l / 100, o);
    }
    function fromData(e, n, r, i, a, o) {
        // e = call or put data: {"b": 156.15,"a": 157.05,"oi": 44,"v": 0}
        // n = 1 for CALL, 2 for PUT
        // r = expiration datetime object (at market close)
        // i = strike price
        // a = last underlying price
        // o = risk-free interest rates object
        var u = {
            bid: 0,
            ask: 0,
            volatility: 0,
            greeks: {},
            oi: 0,
            volume: 0,
            mark: 0
        };
        u.bid = e.b;
        u.ask = e.a;
        u.mark = Math.round((100 * u.bid + 100 * u.ask) / 2) / 100; // bid-ask midpoint
        u.oi = e.oi;
        u.volume = e.v;
        u.volatility = getIv(u.mark, n, r, i, a, o);
        u.greeks = getGreeks(u.mark, n, r, i, a, o, u.volatility);
        return u;
    }

    for (var expDateStr in optionData.options) {
        // expiration date as string (yymmdd)
        var expDate = new Date(expDateStr.substr(2,2) + '/' + expDateStr.substr(4,2) + '/20' + expDateStr.substr(0,2) + ' 13:00:00'); // should be a date object of expiration (at market close)
        for (var strikePriceStr in optionData.options[expDateStr]) {
            var strikePrice = parseFloat(strikePriceStr);
            var option = optionData.options[expDateStr][strikePriceStr];

            var callData = fromData(option.c, CALL, expDate, strikePrice, optionData.underlying.last, rates);
            var putData =  fromData(option.p, PUT,  expDate, strikePrice, optionData.underlying.last, rates);

            optionData.options[expDateStr][strikePriceStr].c = callData;
            optionData.options[expDateStr][strikePriceStr].p = putData;
        }
    }
}