export async function onRequest(context) {
  const { request, next } = context;
  const response = await next();
  
  // Only process successful HTML requests
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return response;
  }

  // Get the current URL and force it to be non-www for the canonical string
  const url = new URL(request.url);
  const cleanHost = url.hostname.replace(/^www\./, "");
  const canonicalUrl = `https://${cleanHost}${url.pathname}${url.search}`;

  // Dynamically inject the canonical tag into the HTML <head> server-side
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(`<link rel="canonical" href="${canonicalUrl}" />`, { html: true });
      },
    })
    .transform(response);
}
