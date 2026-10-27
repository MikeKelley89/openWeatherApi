/* OpenWeather demo client. API credentials are kept in a Cloudflare Worker secret. */
(function ($) {
  "use strict";

  // After deploying worker/, replace the placeholder hostname with your Worker URL.
  const weatherEndpoint = "https://openweather-proxy.REPLACE-WITH-YOUR-CLOUDFLARE-SUBDOMAIN.workers.dev/weather";
  const $form = $("#localWeather");
  const $zip = $("#zip");
  const $button = $("#findWeather");
  const $results = $(".results");
  const $apiError = $("#apiError");
  const $alert = $("#alert");

  function clearWeather() {
    $results.hide();
    $apiError.hide();
    $alert.hide();
  }

  function validZip(value) {
    return /^\d{5}$/.test(value);
  }

  function showError(xhr, fallback) {
    const payload = xhr.responseJSON || {};
    const message = payload.error && payload.error.message
      ? payload.error.message
      : fallback;
    $("#errorCode").text(xhr.status ? xhr.status + ": " : "");
    $("#errorMsg").text(message);
    $apiError.show();
  }

  $zip.on("input", function () {
    const zip = this.value.trim();
    const valid = validZip(zip);
    $button.prop("disabled", !valid);
    $("#zipStatus").toggle(!valid);
    if (!valid) clearWeather();
  });

  $form.on("submit", function (event) {
    event.preventDefault();
    const zip = $zip.val().trim();
    if (!validZip(zip)) {
      $("#zipStatus").show();
      return;
    }

    clearWeather();
    $button.prop("disabled", true);

    $.ajax({
      url: weatherEndpoint,
      method: "GET",
      data: { zip: zip },
      dataType: "json",
      timeout: 12000
    }).done(function (payload) {
      const location = payload.location || {};
      const weather = payload.weather || {};
      const current = weather.current || {};
      const daily = (weather.daily && weather.daily[0]) || {};
      const currentCondition = (current.weather && current.weather[0]) || {};

      $("#conditions").text("Conditions for " + (location.name || "Selected location") + ", " + (location.country || "US") + "...");
      $("#main_temp").text(Number.isFinite(current.temp) ? Math.round(current.temp) : "Unavailable");
      $("#wind_speed").text(Number.isFinite(current.wind_speed) ? current.wind_speed : "Unavailable");
      $("#wind_direction").text(Number.isFinite(current.wind_deg) ? current.wind_deg : "Unavailable");
      $("#weather_conditions").text(
        (daily.summary ? daily.summary + " " : "") +
        (currentCondition.description ? "Currently: " + currentCondition.description + "." : "Current conditions are unavailable.")
      );
      $results.show();

      const alerts = Array.isArray(weather.alerts) ? weather.alerts : [];
      if (alerts.length) {
        const alert = alerts[0];
        $("#sender_name").text(alert.sender_name || "Weather service");
        $("#event").text(alert.event || "Weather alert");
        $("#start").text(alert.start ? new Date(alert.start * 1000).toLocaleString() : "Not provided");
        $("#end").text(alert.end ? new Date(alert.end * 1000).toLocaleString() : "Not provided");
        $("#description").text(alert.description || "No description provided.");
        $("#tags").text(Array.isArray(alert.tags) ? alert.tags.join(", ") : "Not provided");
        $alert.show();
      }
    }).fail(function (xhr, textStatus) {
      showError(xhr, textStatus === "timeout"
        ? "The request timed out. Please try again."
        : "The weather service could not complete the lookup.");
    }).always(function () {
      $button.prop("disabled", !validZip($zip.val().trim()));
    });
  });
})(jQuery);
