// Buscadores disponibles: home = página de inicio de las pestañas nuevas, search = URL con %s por la consulta.
module.exports = {
  duckduckgo: { name: 'DuckDuckGo', home: 'https://duckduckgo.com', search: 'https://duckduckgo.com/?q=%s' },
  google: { name: 'Google', home: 'https://www.google.com', search: 'https://www.google.com/search?q=%s' },
  bing: { name: 'Bing', home: 'https://www.bing.com', search: 'https://www.bing.com/search?q=%s' },
  brave: { name: 'Brave', home: 'https://search.brave.com', search: 'https://search.brave.com/search?q=%s' },
  startpage: { name: 'Startpage', home: 'https://www.startpage.com', search: 'https://www.startpage.com/do/search?q=%s' },
  ecosia: { name: 'Ecosia', home: 'https://www.ecosia.org', search: 'https://www.ecosia.org/search?q=%s' },
};
