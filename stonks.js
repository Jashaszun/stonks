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
        if (window.localStorage.getItem("stockPrices")) {
            stockPrices = JSON.parse(window.localStorage.getItem("stockPrices")/*, function (key, value) {
                // startDate and endDate are in top level for each ticker
                // date is in each price object within the prices of each ticker
                // They're strings, but we want Date objects
                if (key === 'startDate' || key === 'endDate' || key === 'date') {
                    return new Date(value);
                }
                return value;
            }*/);
        }
        if (window.localStorage.getItem("trades")) {
            trades = JSON.parse(window.localStorage.getItem("trades"));
            for (var i in trades) {
                addTrade(trades[i], true);
            }
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
                // var startDateStr = request.startDate.getFullYear().toString() + '-' + 
                //     (request.startDate.getMonth()+1).toString().padStart(2, '0') + '-' + 
                //     request.startDate.getDate().toString().padStart(2, '0');
                // var endDateStr = request.endDate.getFullYear().toString() + '-' + 
                //     (request.endDate.getMonth()+1).toString().padStart(2, '0') + '-' + 
                //     request.endDate.getDate().toString().padStart(2, '0');
                // $.getJSON("https://api.polygon.io/v2/aggs/ticker/" + request.ticker + "/range/1/day/" + startDateStr + "/" + endDateStr +
                //     "?unadjusted=false&sort=asc&limit=50000&apiKey=UnHyngIUP8cW5jGX17pCpjWipUPDzPr9", function(data) {
                $.getJSON("http://73.254.230.39:8123/ticker/" + request.ticker, function(data) {
                    console.log("Got historical data for " + request.ticker);
                    // for (var i in data.results) {
                    //     // The times are given at 9pm the night before (???), so add 19 hours to get to 4pm of the correct day.
                    //     data.results[i].t += 19 * 60 * 60 * 1000;
                    //     data.results[i].date = new Date(data.results[i].t);
                    //     data.results[i].date = new Date(data.results[i].date.getFullYear(), data.results[i].date.getMonth(), data.results[i].date.getDate());
                    // }
                    // var storedPrices = {
                    //     startDate: request.startDate,
                    //     endDate: request.endDate,
                    //     prices: data.results
                    // };
                    // stockPrices[request.ticker] = storedPrices;
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

    var sortedTrades = trades.slice();
    sortedTrades.sort(function (a, b) { return new Date(a.date).getTime() - new Date(b.date).getTime() });
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

var tradeSortAscending = false;
function addTrade(trade, addingBulk) {
    if (!addingBulk) {
        trades.push(trade);
        saveTrades();
    }

    var newRow = 
        '<tr class="trade-table-tr trade-table-' + (trade.buying ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
        '    <td>' + trade.date + '</td>' +
        '    <td>' + (trade.buying ? 'Buy' : 'Sell') + '</td>' +
        '    <td>' + trade.ticker + '</td>' +
        '    <td>' + trade.qty.toString() + '</td>' +
        '    <td>' + getPriceText(trade.price) + '</td>' +
        '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
        '</tr>';
    if (tradeSortAscending) {
        $('#trades-table tbody').append(newRow);
    } else {
        $('#trades-table tbody').prepend(newRow);
    }

    if (!addingBulk) {
        updateStats();
    }
}
function updateTrade(index, newTrade) {
    trades[index] = newTrade;
    saveTrades();

    var rowIndex = tradeSortAscending ? index : (trades.length - 1 - index);
    $('#trades-table tbody').find('tr').eq(rowIndex).replaceWith(
        '<tr class="trade-table-tr trade-table-' + (newTrade.buying ? 'buy' : 'sell') + '-tr" ondblclick="tradeDoubleClicked(this)">' +
        '    <td>' + newTrade.date + '</td>' +
        '    <td>' + (newTrade.buying ? 'Buy' : 'Sell') + '</td>' +
        '    <td>' + newTrade.ticker + '</td>' +
        '    <td>' + newTrade.qty.toString() + '</td>' +
        '    <td>' + getPriceText(newTrade.price) + '</td>' +
        '    <td><button type="button" class="btn-close" onclick="removeTradeBtnClicked(this)"></button></td>' +
        '</tr>'
    );

    updateStats();
}
function removeTrade(index) {
    trades.splice(index, 1);
    saveTrades();

    var rowIndex = tradeSortAscending ? index : (trades.length - 1 - index);
    $('#trades-table tbody').find('tr').eq(rowIndex).remove();

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
    if (!tradeSortAscending) {
        editingTradeIndex = trades.length - 1 - editingTradeIndex;
    }

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
                '<tr' + (trade.pl > 0 ? ' class="trade-table-profit-tr"' : (trade.pl < 0 ? ' class="trade-table-loss-tr"' : '')) + '>' +
                '    <td>' + trade.date + '</td>' +
                '    <td>' + (trade.buying ? 'Buy' : 'Sell') + '</td>' +
                '    <td>' + trade.qty.toString() + '</td>' +
                '    <td>' + getPriceText(trade.price) + '</td>' +
                '    <td>' + getPriceText(trade.stockBought) + '</td>' +
                '    <td>' + getPriceText(trade.stockSold) + '</td>' +
                '    <td>' + trade.lots.length.toString() + '</td>' +
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
    var rowHTML = [];
    $('#trades-table tbody tr').each(function() {
        rowHTML.splice(0, 0, $(this).html());
    });
    $('#trades-table tbody tr').each(function() {
        var html = rowHTML.splice(0, 1)[0];
        $(this).html(html);
    });

    if (tradeSortAscending) {
        $('#trade-sort-icon').removeClass('bi-caret-down-fill');
        $('#trade-sort-icon').addClass('bi-caret-up-fill');
    } else {
        $('#trade-sort-icon').removeClass('bi-caret-up-fill');
        $('#trade-sort-icon').addClass('bi-caret-down-fill');
    }
}