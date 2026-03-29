var Genres = {
    container: null,
    isVisible: false,
    currentView: 'grid',
    genres: [],
    selectedGenre: null,
    browseItems: [],
    browseTotalCount: 0,
    sortBy: 'SortName',
    sortOrder: 'Ascending',
    filterType: 'all',
    libraryFilterId: 'all',
    libraryFilterOptions: [
        { key: 'all', label: 'All Libraries' }
    ],
    startLetter: null,
    loading: false,
    browseLoading: false,
    browseStartIndex: 0,
    imageSize: 'medium',
    imageType: 'poster',
    gridDirection: 'vertical',
    showSettingsPanel: false,

    SORT_OPTIONS: [
        { key: 'SortName,Ascending', label: 'Name (A-Z)' },
        { key: 'SortName,Descending', label: 'Name (Z-A)' },
        { key: 'CommunityRating,Descending', label: 'Rating' },
        { key: 'DateCreated,Descending', label: 'Date Added' },
        { key: 'PremiereDate,Descending', label: 'Release Date' },
        { key: 'Random,Ascending', label: 'Random' }
    ],

    FILTER_OPTIONS: [
        { key: 'all', label: 'All' },
        { key: 'Movie', label: 'Movies' },
        { key: 'Series', label: 'TV Shows' }
    ],

    LETTERS: ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],

    BATCH_SIZE: 60,

    init: function() {
        this.createContainer();
    },

    createContainer: function() {
        var existing = document.querySelector('.moonfin-genres-overlay');
        if (existing) existing.remove();

        this.container = document.createElement('div');
        this.container.className = 'moonfin-genres-overlay';
        document.body.appendChild(this.container);
    },

    show: function() {
        if (!this.container) this.createContainer();

        var stored = this.getStoredViewPrefs();
        this.imageSize = stored.imageSize || 'medium';
        this.imageType = stored.imageType || 'poster';
        this.gridDirection = stored.gridDirection || 'vertical';
        this.showSettingsPanel = false;

        this.currentView = 'grid';
        this.selectedGenre = null;
        this.isVisible = true;
        this.container.classList.add('visible');
        document.body.classList.add('moonfin-genres-visible');
        document.body.style.overflow = 'hidden';
        history.pushState({ moonfinGenres: true }, '');
        if (window.Moonfin && window.Moonfin.Plugin) window.Moonfin.Plugin._overlayHistoryDepth++;
        else if (typeof Plugin !== 'undefined') Plugin._overlayHistoryDepth++;

        this.loadLibraryFilterOptions();
        this.loadGenres();
    },

    hide: function() {
        if (this.currentView === 'browse') {
            this.showGrid();
            return;
        }

        this.isVisible = false;
        this.container.classList.remove('visible');
        document.body.classList.remove('moonfin-genres-visible');
        document.body.style.overflow = '';
        try { history.back(); } catch(e) {}
    },

    close: function() {
        this.isVisible = false;
        if (this.container) this.container.classList.remove('visible');
        document.body.classList.remove('moonfin-genres-visible');
        document.body.style.overflow = '';
    },

    async loadLibraryFilterOptions() {
        try {
            var views = await API.getUserViews();
            var opts = [{ key: 'all', label: 'All Libraries' }];
            for (var i = 0; i < views.length; i++) {
                var view = views[i] || {};
                var ct = (view.CollectionType || '').toLowerCase();
                if (ct === 'movies' || ct === 'tvshows') {
                    opts.push({ key: view.Id, label: view.Name || 'Library' });
                }
            }
            this.libraryFilterOptions = opts;
        } catch (e) {
            this.libraryFilterOptions = [{ key: 'all', label: 'All Libraries' }];
        }
    },

    showGrid: function() {
        this.currentView = 'grid';
        this.selectedGenre = null;
        this.showSettingsPanel = false;
        this.renderGrid();
    },

    getStoredViewPrefs: function() {
        try {
            var raw = localStorage.getItem('moonfin_genres_view');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    saveViewPrefs: function() {
        try {
            localStorage.setItem('moonfin_genres_view', JSON.stringify({
                imageSize: this.imageSize,
                imageType: this.imageType,
                gridDirection: this.gridDirection
            }));
        } catch (e) {}
    },

    capitalize: function(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    },

    getCardShapeClass: function(item) {
        if (this.imageType === 'thumbnail') return 'type-landscape';
        if (this.imageType === 'square' || (item && (item.Type === 'MusicAlbum' || item.Type === 'MusicArtist' || item.Type === 'Audio'))) {
            return 'type-square';
        }
        return 'type-poster';
    },

    getPosterHeight: function() {
        if (this.imageType === 'square') {
            return this.imageSize === 'small' ? 140 : (this.imageSize === 'large' ? 240 : 180);
        }
        if (this.imageType === 'thumbnail') {
            return this.imageSize === 'small' ? 120 : (this.imageSize === 'large' ? 210 : 160);
        }
        return this.imageSize === 'small' ? 200 : (this.imageSize === 'large' ? 350 : 270);
    },

    getAdaptiveGridClass: function() {
        var directionClass = this.gridDirection === 'horizontal' ? 'moonfin-grid-horizontal' : 'moonfin-grid-vertical';
        var typeClass = this.imageType === 'thumbnail' ? 'type-landscape' : (this.imageType === 'square' ? 'type-square' : 'type-poster');
        return 'moonfin-genres-adaptive-grid ' + directionClass + ' size-' + this.imageSize + ' ' + typeClass;
    },

    renderSettingsPanel: function() {
        if (!this.showSettingsPanel) return '';
        var html = '';
        html += '<div class="moonfin-library-panel-overlay" data-action="close-settings-panel">';
        html += '  <div class="moonfin-library-side-panel" data-stop-prop="1">';
        html += '    <div class="moonfin-library-settings-header">GENRES</div>';
        html += '    <h2 class="moonfin-library-panel-title">View Settings</h2>';
        html += '    <button class="moonfin-library-setting-row" data-action="cycle-image-size"><span>Image size</span><b>' + this.capitalize(this.imageSize) + '</b></button>';
        html += '    <button class="moonfin-library-setting-row" data-action="cycle-image-type"><span>Image type</span><b>' + this.capitalize(this.imageType) + '</b></button>';
        html += '    <button class="moonfin-library-setting-row" data-action="cycle-grid-direction"><span>Grid direction</span><b>' + this.capitalize(this.gridDirection) + '</b></button>';
        html += '  </div>';
        html += '</div>';
        return html;
    },

    async loadGenres() {
        this.loading = true;
        this.renderGrid();

        try {
            var genreList = await API.getGenres();
            if (!genreList || genreList.length === 0) {
                this.genres = [];
                this.loading = false;
                this.renderGrid();
                return;
            }

            var self = this;
            var enriched = [];
            var batchSize = 8;

            for (var i = 0; i < genreList.length; i += batchSize) {
                var batch = genreList.slice(i, i + batchSize);
                var promises = batch.map(function(genre) {
                    return API.getGenreItems(genre.Name, {
                        limit: 3,
                        sortBy: 'Random',
                        includeItemTypes: 'Movie,Series'
                    }).then(function(result) {
                        var backdropUrl = null;
                        var items = result.Items || [];
                        for (var j = 0; j < items.length; j++) {
                            backdropUrl = API.getBackdropUrl(items[j], { maxWidth: 780, quality: 80 });
                            if (backdropUrl) break;
                        }
                        return {
                            id: genre.Id,
                            name: genre.Name,
                            itemCount: result.TotalRecordCount || 0,
                            backdropUrl: backdropUrl
                        };
                    }).catch(function() {
                        return {
                            id: genre.Id,
                            name: genre.Name,
                            itemCount: 0,
                            backdropUrl: null
                        };
                    });
                });

                var batchResults = await Promise.all(promises);
                enriched = enriched.concat(batchResults);
            }

            enriched.sort(function(a, b) { return a.name.localeCompare(b.name); });
            self.genres = enriched;
            self.loading = false;
            self.renderGrid();
        } catch (e) {
            console.error('[Moonfin] Failed to load genres:', e);
            this.loading = false;
            this.genres = [];
            this.renderGrid();
        }
    },

    renderGrid: function() {
        if (!this.container) return;

        var self = this;
        var html = '';

        html += '<div class="moonfin-genres-header moonfin-genres-main-header">';
        html += '  <div class="moonfin-genres-header-actions">';
        html += '    <button class="moonfin-genres-header-btn" data-action="home" title="Home"><span class="material-icons">home</span></button>';
        html += '    <button class="moonfin-genres-header-btn" data-action="toggle-settings-panel" title="Settings"><span class="material-icons">settings</span></button>';
        html += '  </div>';
        html += '  <div class="moonfin-genres-title-section">';
        html += '    <h1 class="moonfin-genres-title">Genres</h1>';
        html += '    <span class="moonfin-genres-count">' + this.genres.length + ' genres</span>';
        html += '  </div>';
        html += '</div>';

        if (this.loading) {
            html += '<div class="moonfin-genres-loading"><div class="moonfin-genres-spinner"></div></div>';
        } else if (this.genres.length === 0) {
            html += '<div class="moonfin-genres-empty">No genres found</div>';
        } else {
            html += '<div class="moonfin-genres-grid ' + this.getAdaptiveGridClass() + '">';
            for (var i = 0; i < this.genres.length; i++) {
                var genre = this.genres[i];
                var shapeClass = this.getCardShapeClass(null);
                html += '<div class="moonfin-genre-card moonfin-genre-item-card ' + shapeClass + ' size-' + this.imageSize + '" data-genre-index="' + i + '">';
                html += '  <div class="moonfin-genre-backdrop">';
                if (genre.backdropUrl) {
                    html += '    <img class="moonfin-genre-backdrop-img" src="' + genre.backdropUrl + '" alt="" loading="lazy">';
                } else {
                    html += '    <div class="moonfin-genre-backdrop-placeholder"></div>';
                }
                html += '    <div class="moonfin-genre-backdrop-overlay"></div>';
                html += '  </div>';
                html += '  <div class="moonfin-genre-info">';
                html += '    <div class="moonfin-genre-name">' + genre.name + '</div>';
                if (genre.itemCount > 0) {
                    html += '    <div class="moonfin-genre-item-count">' + genre.itemCount + ' items</div>';
                }
                html += '  </div>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += this.renderSettingsPanel();

        this.container.innerHTML = html;
        this.bindGridEvents();
    },

    bindGridEvents: function() {
        var self = this;

        if (this._gridClickHandler) {
            this.container.removeEventListener('click', this._gridClickHandler);
            this._gridClickHandler = null;
        }

        this._gridClickHandler = function(e) {
            if (e.target.closest('[data-stop-prop="1"]') && !e.target.closest('[data-action]')) return;

            var target = e.target.closest('[data-action], .moonfin-genre-card, .moonfin-library-panel-overlay');
            if (!target) return;

            var action = target.getAttribute('data-action');
            if (!action && target.classList.contains('moonfin-genre-card')) {
                var index = parseInt(target.dataset.genreIndex, 10);
                var genre = self.genres[index];
                if (genre) self.openGenre(genre);
                return;
            }

            switch (action) {
                case 'home':
                    self.close();
                    API.navigateTo('/home');
                    break;
                case 'toggle-settings-panel':
                    self.showSettingsPanel = !self.showSettingsPanel;
                    self.renderGrid();
                    break;
                case 'close-settings-panel':
                    self.showSettingsPanel = false;
                    self.renderGrid();
                    break;
                case 'cycle-image-size':
                    self.imageSize = self.imageSize === 'small' ? 'medium' : (self.imageSize === 'medium' ? 'large' : 'small');
                    self.saveViewPrefs();
                    self.renderGrid();
                    break;
                case 'cycle-image-type':
                    self.imageType = self.imageType === 'poster' ? 'thumbnail' : (self.imageType === 'thumbnail' ? 'square' : 'poster');
                    self.saveViewPrefs();
                    self.renderGrid();
                    break;
                case 'cycle-grid-direction':
                    self.gridDirection = self.gridDirection === 'vertical' ? 'horizontal' : 'vertical';
                    self.saveViewPrefs();
                    self.renderGrid();
                    break;
            }
        };
        this.container.addEventListener('click', this._gridClickHandler);

        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }
        this._escHandler = function(e) {
            if (e.key === 'Escape' && self.isVisible) {
                e.preventDefault();
                e.stopPropagation();
                self.hide();
            }
        };
        document.addEventListener('keydown', this._escHandler);
    },

    openGenre: function(genre) {
        this.currentView = 'browse';
        this.selectedGenre = genre;
        this.browseItems = [];
        this.browseTotalCount = 0;
        this.browseStartIndex = 0;
        this.sortBy = 'SortName';
        this.sortOrder = 'Ascending';
        this.filterType = 'all';
        this.libraryFilterId = 'all';
        this.startLetter = null;
        this.showSettingsPanel = false;
        this._mdbCache = {};

        this.loadBrowseItems(true);
    },

    async loadBrowseItems(isReset) {
        if (isReset) {
            this.browseStartIndex = 0;
            this.browseItems = [];
            this.browseLoading = true;
            this.renderBrowse();
        }

        var includeItemTypes = this.filterType === 'all' ? 'Movie,Series' : this.filterType;
        var options = {
            startIndex: this.browseStartIndex,
            limit: this.BATCH_SIZE,
            sortBy: this.sortBy,
            sortOrder: this.sortOrder,
            includeItemTypes: includeItemTypes
        };

        if (this.libraryFilterId && this.libraryFilterId !== 'all') {
            options.parentId = this.libraryFilterId;
        }

        if (this.startLetter) {
            if (this.startLetter === '#') {
                options.nameLessThan = 'A';
            } else {
                options.nameStartsWith = this.startLetter;
            }
        }

        try {
            var result = await API.getGenreItems(this.selectedGenre.name, options);
            this.browseTotalCount = result.TotalRecordCount || 0;

            if (isReset) {
                this.browseItems = result.Items || [];
            } else {
                this.browseItems = this.browseItems.concat(result.Items || []);
            }

            this.browseLoading = false;
            this.renderBrowse();
        } catch (e) {
            console.error('[Moonfin] Failed to load browse items:', e);
            this.browseLoading = false;
            this.renderBrowse();
        }
    },

    renderBrowse: function() {
        if (!this.container) return;
        var self = this;

        var currentSortKey = this.sortBy + ',' + this.sortOrder;
        var currentSort = this.SORT_OPTIONS.find(function(o) { return o.key === currentSortKey; });
        var currentLibrary = this.libraryFilterOptions.find(function(o) { return o.key === self.libraryFilterId; });

        var html = '';

        html += '<div class="moonfin-genres-header moonfin-genres-browse-header">';
        html += '  <div class="moonfin-genres-header-actions moonfin-genres-header-actions-left">';
        html += '    <button class="moonfin-genres-header-btn" data-action="back" title="Back"><span class="material-icons">arrow_back</span></button>';
        html += '    <button class="moonfin-genres-toolbar-btn" data-action="sort">';
        html += '      <span class="material-icons">sort</span>';
        html += '      <span>' + (currentSort ? currentSort.label : 'Sort') + '</span>';
        html += '    </button>';
        html += '    <button class="moonfin-genres-toolbar-btn" data-action="library-filter">';
        html += '      <span class="material-icons">video_library</span>';
        html += '      <span>' + (currentLibrary ? currentLibrary.label : 'All Libraries') + '</span>';
        html += '    </button>';
        html += '    <button class="moonfin-genres-header-btn" data-action="toggle-settings-panel" title="Settings"><span class="material-icons">settings</span></button>';
        html += '  </div>';
        html += '  <div class="moonfin-genres-title-section">';
        html += '    <h1 class="moonfin-genres-title">' + this.selectedGenre.name + '</h1>';
        html += '    <span class="moonfin-genres-count">' + this.browseTotalCount + ' items</span>';
        html += '  </div>';
        html += '</div>';

        html += '<div class="moonfin-genres-letter-bar">';
        for (var i = 0; i < this.LETTERS.length; i++) {
            var letter = this.LETTERS[i];
            var activeClass = this.startLetter === letter ? ' active' : '';
            html += '<button class="moonfin-genres-letter-btn' + activeClass + '" data-letter="' + letter + '">' + letter + '</button>';
        }
        html += '</div>';

        if (this.browseLoading && this.browseItems.length === 0) {
            html += '<div class="moonfin-genres-loading"><div class="moonfin-genres-spinner"></div></div>';
        } else if (this.browseItems.length === 0) {
            html += '<div class="moonfin-genres-empty">No items found</div>';
        } else {
            html += '<div class="moonfin-genres-browse-grid ' + this.getAdaptiveGridClass() + '">';
            for (var j = 0; j < this.browseItems.length; j++) {
                var item = this.browseItems[j];
                var shapeClass = this.getCardShapeClass(item);
                var imageType = this.imageType === 'thumbnail' ? 'Thumb' : 'Primary';
                var posterUrl = imageType === 'Thumb'
                    ? (item.ImageTags && item.ImageTags.Thumb ? API.getImageUrl(item, 'Thumb', { maxWidth: 500 }) : null)
                    : API.getPrimaryImageUrl(item, { maxWidth: 500 });
                if (!posterUrl) {
                    posterUrl = API.getBackdropUrl(item, { maxWidth: 500 });
                }
                var year = item.ProductionYear || '';
                var rating = item.CommunityRating ? item.CommunityRating.toFixed(1) : '';
                var officialRating = item.OfficialRating || '';
                var typeLabel = item.Type === 'Movie' ? 'MOVIE' : item.Type === 'Series' ? 'SERIES' : '';

                html += '<div class="moonfin-genre-item-card ' + shapeClass + ' size-' + this.imageSize + '" data-item-id="' + item.Id + '">';
                html += '  <div class="moonfin-genre-item-poster" style="height:' + this.getPosterHeight() + 'px">';
                if (posterUrl) {
                    html += '    <img src="' + posterUrl + '" alt="' + (item.Name || '').replace(/"/g, '&quot;') + '" loading="lazy">';
                } else {
                    html += '    <div class="moonfin-genre-item-no-poster"><span class="material-icons">movie</span></div>';
                }
                if (typeLabel) {
                    html += '    <span class="moonfin-genre-item-type-badge ' + (item.Type === 'Movie' ? 'movie' : 'series') + '">' + typeLabel + '</span>';
                }
                html += '  </div>';
                html += '  <div class="moonfin-genre-item-info">';
                html += '    <div class="moonfin-genre-item-name">' + (item.Name || 'Unknown') + '</div>';
                html += '    <div class="moonfin-genre-item-meta">';
                if (year) html += '<span>' + year + '</span>';
                if (officialRating) html += '<span class="moonfin-genre-item-meta-cert">' + officialRating + '</span>';
                if (rating) html += '<span class="moonfin-genre-item-meta-rating">&#9733; ' + rating + '</span>';
                if (!year && !officialRating && !rating) html += '<span class="moonfin-genre-item-meta-empty">&nbsp;</span>';
                html += '    </div>';
                html += '    <div class="moonfin-genre-item-mdblist moonfin-mdblist-ratings-row"></div>';
                html += '  </div>';
                html += '</div>';
            }

            if (this.browseItems.length < this.browseTotalCount) {
                html += '<div class="moonfin-genres-load-more" data-action="load-more">';
                html += '  <button class="moonfin-genres-toolbar-btn">Load More</button>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += this.renderSettingsPanel();

        this.container.innerHTML = html;
        this.bindBrowseEvents();
    },

    bindBrowseEvents: function() {
        var self = this;

        if (this._gridClickHandler) {
            this.container.removeEventListener('click', this._gridClickHandler);
            this._gridClickHandler = null;
        }

        var itemCards = this.container.querySelectorAll('.moonfin-genre-item-card');
        for (var i = 0; i < itemCards.length; i++) {
            (function(card) {
                card.addEventListener('click', function() {
                    var itemId = this.dataset.itemId;
                    if (itemId) {
                        if (typeof Details !== 'undefined' && Storage.get('detailsPageEnabled')) {
                            Details.showDetails(itemId);
                        } else {
                            API.navigateToItem(itemId);
                            self.isVisible = false;
                            self.container.classList.remove('visible');
                            document.body.classList.remove('moonfin-genres-visible');
                            document.body.style.overflow = '';
                        }
                    }
                });

                if (typeof MdbList !== 'undefined' && MdbList.isEnabled()) {
                    card.addEventListener('mouseenter', function() {
                        var itemId = card.dataset.itemId;
                        var item = null;
                        for (var k = 0; k < self.browseItems.length; k++) {
                            if (self.browseItems[k].Id === itemId) { item = self.browseItems[k]; break; }
                        }
                        if (!item) return;

                        var mdbDiv = card.querySelector('.moonfin-genre-item-mdblist');
                        if (!mdbDiv) return;

                        if (self._mdbCache && self._mdbCache[itemId] !== undefined) {
                            mdbDiv.innerHTML = self._mdbCache[itemId];
                            return;
                        }

                        MdbList.fetchRatings(item).then(function(ratings) {
                            var html = MdbList.buildRatingsHtml(ratings, 'compact') || '';
                            self._mdbCache[itemId] = html;
                            if (card.matches(':hover')) {
                                mdbDiv.innerHTML = html;
                            }
                        });
                    });

                    card.addEventListener('mouseleave', function() {
                        var mdbDiv = card.querySelector('.moonfin-genre-item-mdblist');
                        if (mdbDiv) mdbDiv.innerHTML = '';
                    });
                }
            })(itemCards[i]);
        }

        var sortBtn = this.container.querySelector('[data-action="sort"]');
        if (sortBtn) sortBtn.addEventListener('click', function() { self.showSortMenu(); });

        var backBtn = this.container.querySelector('[data-action="back"]');
        if (backBtn) {
            backBtn.addEventListener('click', function() {
                self.showGrid();
            });
        }

        var settingsBtn = this.container.querySelector('[data-action="toggle-settings-panel"]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', function() {
                self.showSettingsPanel = !self.showSettingsPanel;
                self.renderBrowse();
            });
        }

        var closePanel = this.container.querySelector('[data-action="close-settings-panel"]');
        if (closePanel) {
            closePanel.addEventListener('click', function() {
                self.showSettingsPanel = false;
                self.renderBrowse();
            });
        }

        var cycleImageSize = this.container.querySelector('[data-action="cycle-image-size"]');
        if (cycleImageSize) {
            cycleImageSize.addEventListener('click', function() {
                self.imageSize = self.imageSize === 'small' ? 'medium' : (self.imageSize === 'medium' ? 'large' : 'small');
                self.saveViewPrefs();
                self.renderBrowse();
            });
        }

        var cycleImageType = this.container.querySelector('[data-action="cycle-image-type"]');
        if (cycleImageType) {
            cycleImageType.addEventListener('click', function() {
                self.imageType = self.imageType === 'poster' ? 'thumbnail' : (self.imageType === 'thumbnail' ? 'square' : 'poster');
                self.saveViewPrefs();
                self.renderBrowse();
            });
        }

        var cycleGridDirection = this.container.querySelector('[data-action="cycle-grid-direction"]');
        if (cycleGridDirection) {
            cycleGridDirection.addEventListener('click', function() {
                self.gridDirection = self.gridDirection === 'vertical' ? 'horizontal' : 'vertical';
                self.saveViewPrefs();
                self.renderBrowse();
            });
        }

        var libraryFilterBtn = this.container.querySelector('[data-action="library-filter"]');
        if (libraryFilterBtn) {
            libraryFilterBtn.addEventListener('click', function() { self.showLibraryFilterMenu(); });
        }

        var letterBtns = this.container.querySelectorAll('.moonfin-genres-letter-btn');
        for (var j = 0; j < letterBtns.length; j++) {
            letterBtns[j].addEventListener('click', function() {
                var letter = this.dataset.letter;
                self.startLetter = self.startLetter === letter ? null : letter;
                self.loadBrowseItems(true);
            });
        }

        var loadMoreBtn = this.container.querySelector('[data-action="load-more"]');
        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', function() {
                self.browseStartIndex = self.browseItems.length;
                self.loadBrowseItems(false);
            });
        }

        var browseGrid = this.container.querySelector('.moonfin-genres-browse-grid');
        if (browseGrid) {
            if (this._scrollHandler) {
                this.container.removeEventListener('scroll', this._scrollHandler);
                this._scrollHandler = null;
            }

            this._scrollHandler = function() {
                if (self.browseLoading) return;
                if (self.browseItems.length >= self.browseTotalCount) return;

                var scrollTop = self.container.scrollTop;
                var scrollHeight = self.container.scrollHeight;
                var clientHeight = self.container.clientHeight;

                if (scrollTop + clientHeight >= scrollHeight - 400) {
                    self.browseStartIndex = self.browseItems.length;
                    self.loadBrowseItems(false);
                }
            };
            this.container.addEventListener('scroll', this._scrollHandler);
        }

        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }
        this._escHandler = function(e) {
            if (e.key === 'Escape' && self.isVisible) {
                e.preventDefault();
                e.stopPropagation();
                self.hide();
            }
        };
        document.addEventListener('keydown', this._escHandler);
    },

    showSortMenu: function() {
        this.showDropdownMenu('Sort By', this.SORT_OPTIONS, this.sortBy + ',' + this.sortOrder, function(key) {
            var parts = key.split(',');
            this.sortBy = parts[0];
            this.sortOrder = parts[1];
            this.loadBrowseItems(true);
        }.bind(this));
    },

    showLibraryFilterMenu: function() {
        this.showDropdownMenu('Library', this.libraryFilterOptions, this.libraryFilterId, function(key) {
            this.libraryFilterId = key;
            this.loadBrowseItems(true);
        }.bind(this));
    },

    showDropdownMenu: function(title, options, activeKey, onSelect) {
        var existing = document.querySelector('.moonfin-genres-dropdown');
        if (existing) existing.remove();

        var dropdown = document.createElement('div');
        dropdown.className = 'moonfin-genres-dropdown';

        var html = '<div class="moonfin-genres-dropdown-backdrop"></div>';
        html += '<div class="moonfin-genres-dropdown-content">';
        html += '<div class="moonfin-genres-dropdown-title">' + title + '</div>';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var isActive = Array.isArray(activeKey) ? activeKey.indexOf(opt.key) !== -1 : opt.key === activeKey;
            var activeClass = isActive ? ' active' : '';
            html += '<button class="moonfin-genres-dropdown-option' + activeClass + '" data-key="' + opt.key + '">' + opt.label + '</button>';
        }
        html += '</div>';
        dropdown.innerHTML = html;

        document.body.appendChild(dropdown);

        dropdown.querySelector('.moonfin-genres-dropdown-backdrop').addEventListener('click', function() {
            dropdown.remove();
        });
        var optBtns = dropdown.querySelectorAll('.moonfin-genres-dropdown-option');
        for (var j = 0; j < optBtns.length; j++) {
            optBtns[j].addEventListener('click', function() {
                var key = this.dataset.key;
                dropdown.remove();
                onSelect(key);
            });
        }

        requestAnimationFrame(function() { dropdown.classList.add('visible'); });
    },

    destroy: function() {
        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
            this._escHandler = null;
        }
        if (this._scrollHandler && this.container) {
            this.container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }
        if (this._gridClickHandler && this.container) {
            this.container.removeEventListener('click', this._gridClickHandler);
            this._gridClickHandler = null;
        }
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        document.body.classList.remove('moonfin-genres-visible');
        this.isVisible = false;
    }
};
