var Library = {
    container: null,
    isVisible: false,
    libraryId: null,
    libraryName: '',
    collectionType: '',
    items: [],
    totalCount: 0,
    sortKey: 'SortName',
    favoritesOnly: false,
    watchedOnly: false,
    startLetter: null,
    loading: false,
    startIndex: 0,
    imageSize: 'medium',
    imageType: 'poster',
    gridDirection: 'vertical',
    folderView: false,
    folderStack: [],
    focusedItem: null,
    showSortPanel: false,
    showSettingsPanel: false,
    musicContentType: 'albums',
    focusedMdbHtml: '',
    _focusedMdbToken: 0,
    _loadingToken: 0,

    SORT_OPTIONS: [
        { key: 'SortName', field: 'SortName', order: 'Ascending', label: 'Name' },
        { key: 'DateCreated', field: 'DateCreated', order: 'Descending', label: 'Date Added' },
        { key: 'PremiereDate', field: 'PremiereDate', order: 'Descending', label: 'Premiere Date' },
        { key: 'OfficialRating', field: 'OfficialRating', order: 'Ascending', label: 'Rating' },
        { key: 'CommunityRating', field: 'CommunityRating', order: 'Descending', label: 'Community Rating' },
        { key: 'CriticRating', field: 'CriticRating', order: 'Descending', label: 'Critic Rating' },
        { key: 'DatePlayed', field: 'DatePlayed', order: 'Descending', label: 'Last Played' },
        { key: 'Runtime', field: 'Runtime', order: 'Ascending', label: 'Runtime' }
    ],

    MUSIC_SORT_OPTIONS: [
        { key: 'SortName', field: 'SortName', order: 'Ascending', label: 'Name' },
        { key: 'DateCreated', field: 'DateCreated', order: 'Descending', label: 'Date Added' },
        { key: 'CommunityRating', field: 'CommunityRating', order: 'Descending', label: 'Community Rating' },
        { key: 'DatePlayed', field: 'DatePlayed', order: 'Descending', label: 'Last Played' },
        { key: 'AlbumArtist', field: 'AlbumArtist,SortName', order: 'Ascending', label: 'Album Artist' }
    ],

    MUSIC_CONTENT_TYPES: [
        { key: 'albums', label: 'Albums', itemType: 'MusicAlbum' },
        { key: 'artists', label: 'Artists', itemType: 'MusicArtist' }
    ],

    LETTERS: ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],

    BATCH_SIZE: 150,

    init: function() {
        this.createContainer();
    },

    createContainer: function() {
        var existing = document.querySelector('.moonfin-library-overlay');
        if (existing) existing.remove();

        this.container = document.createElement('div');
        this.container.className = 'moonfin-genres-overlay moonfin-library-overlay';
        document.body.appendChild(this.container);
    },

    show: function(libraryId, libraryName, collectionType, options) {
        if (!this.container) this.createContainer();
        options = options || {};

        this.libraryId = libraryId;
        this.libraryName = libraryName || 'Library';
        this.collectionType = (collectionType || '').toLowerCase();
        this.items = [];
        this.totalCount = 0;
        this.startIndex = 0;
        this.startLetter = null;
        this.loading = false;
        this.focusedItem = null;
        this.showSortPanel = false;
        this.showSettingsPanel = false;
        this.folderStack = [];
        this.focusedMdbHtml = '';
        this._focusedMdbToken = 0;
        this._loadingToken++;

        var stored = this.getStoredViewPrefs();
        this.sortKey = options.sortKey || stored.sortKey || 'SortName';
        this.favoritesOnly = false;
        this.watchedOnly = false;
        this.imageSize = stored.imageSize || 'medium';
        this.imageType = stored.imageType || (this.isSquareDefault() ? 'square' : 'poster');
        this.gridDirection = stored.gridDirection || 'vertical';
        this.folderView = stored.folderView || this.shouldDefaultToFolderView();
        this.musicContentType = stored.musicContentType || 'albums';

        this.isVisible = true;
        this.container.classList.add('visible');
        document.body.classList.add('moonfin-library-visible');
        document.body.style.overflow = 'hidden';
        history.pushState({ moonfinLibrary: true }, '');
        if (window.Moonfin && window.Moonfin.Plugin) window.Moonfin.Plugin._overlayHistoryDepth++;
        else if (typeof Plugin !== 'undefined') Plugin._overlayHistoryDepth++;

        this.loadItems(true);
    },

    hide: function() {
        if (this.showSettingsPanel) {
            this.showSettingsPanel = false;
            this.render();
            return;
        }
        if (this.showSortPanel) {
            this.showSortPanel = false;
            this.render();
            return;
        }
        if (this.folderView && this.folderStack.length > 0) {
            this.folderStack.pop();
            this.loadItems(true);
            return;
        }

        this.isVisible = false;
        if (this.container) this.container.classList.remove('visible');
        document.body.classList.remove('moonfin-library-visible');
        document.body.style.overflow = '';
        try { history.back(); } catch(e) {}
    },

    close: function() {
        this.isVisible = false;
        if (this.container) this.container.classList.remove('visible');
        document.body.classList.remove('moonfin-library-visible');
        document.body.style.overflow = '';
    },

    getStoredViewPrefs: function() {
        try {
            var key = 'moonfin_library_view_' + (this.libraryId || 'default');
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    saveViewPrefs: function() {
        try {
            var key = 'moonfin_library_view_' + (this.libraryId || 'default');
            localStorage.setItem(key, JSON.stringify({
                sortKey: this.sortKey,
                imageSize: this.imageSize,
                imageType: this.imageType,
                gridDirection: this.gridDirection,
                folderView: this.folderView,
                musicContentType: this.musicContentType
            }));
        } catch (e) {}
    },

    isMusicLibrary: function() {
        return this.collectionType === 'music';
    },

    isSquareDefault: function() {
        return this.collectionType === 'music' || this.collectionType === 'playlists';
    },

    shouldDefaultToFolderView: function() {
        return this.collectionType === 'homevideos' || this.collectionType === 'mixed';
    },

    shouldShowImageTypeOption: function() {
        return !this.shouldDefaultToFolderView();
    },

    getCurrentFolderId: function() {
        if (this.folderStack.length > 0) {
            return this.folderStack[this.folderStack.length - 1].id;
        }
        return this.libraryId;
    },

    getActiveSortOptions: function() {
        return this.isMusicLibrary() ? this.MUSIC_SORT_OPTIONS : this.SORT_OPTIONS;
    },

    getSortOption: function() {
        var options = this.getActiveSortOptions();
        for (var i = 0; i < options.length; i++) {
            if (options[i].key === this.sortKey) return options[i];
        }
        return options[0];
    },

    getItemTypeForLibrary: function() {
        switch (this.collectionType) {
            case 'movies':
                return 'Movie';
            case 'tvshows':
                return 'Series';
            case 'boxsets':
                return 'BoxSet';
            case 'collection':
                return '';
            case 'homevideos':
                return 'Video,Photo,PhotoAlbum';
            case 'photos':
                return 'Photo,PhotoAlbum';
            case 'music': {
                for (var i = 0; i < this.MUSIC_CONTENT_TYPES.length; i++) {
                    if (this.MUSIC_CONTENT_TYPES[i].key === this.musicContentType) {
                        return this.MUSIC_CONTENT_TYPES[i].itemType;
                    }
                }
                return 'MusicAlbum';
            }
            case 'musicvideos':
                return 'MusicVideo';
            case 'playlists':
                return 'Playlist';
            case 'books':
                return 'Book';
            case 'trailers':
                return 'Trailer';
            default:
                return '';
        }
    },

    getExcludeItemTypes: function() {
        if (this.collectionType === 'movies' || this.collectionType === 'tvshows') {
            return 'BoxSet';
        }
        return '';
    },

    getFilters: function() {
        var filters = [];
        if (this.favoritesOnly) filters.push('IsFavorite');
        if (this.watchedOnly) filters.push('IsPlayed');
        return filters.join(',');
    },

    async loadItems(isReset) {
        if (this.loading && !isReset) return;

        if (isReset) {
            this.startIndex = 0;
            this.items = [];
            this.render();
        }

        this.loading = true;
        var token = ++this._loadingToken;
        var sortOption = this.getSortOption();

        var params = {
            startIndex: this.startIndex,
            limit: this.BATCH_SIZE,
            sortBy: sortOption.field,
            sortOrder: sortOption.order,
            fields: 'PrimaryImageAspectRatio,ProductionYear,CommunityRating,OfficialRating,CriticRating,RunTimeTicks,Overview,Genres,UserData,SortName,Path,ChildCount,MediaSourceCount,AlbumArtist,ProviderIds',
            recursive: !this.folderView,
            nameStartsWith: this.startLetter && this.startLetter !== '#' ? this.startLetter : null,
            nameLessThan: this.startLetter === '#' ? 'A' : null
        };

        if (this.folderView) {
            params.parentId = this.getCurrentFolderId();
            params.sortBy = 'IsFolder,' + sortOption.field;
        } else if (this.libraryId) {
            params.parentId = this.libraryId;
        }

        var includeItemTypes = this.getItemTypeForLibrary();
        if (includeItemTypes) params.includeItemTypes = includeItemTypes;

        var excludeItemTypes = this.getExcludeItemTypes();
        if (excludeItemTypes) params.excludeItemTypes = excludeItemTypes;

        var filters = this.getFilters();
        if (filters) params.filters = filters;

        try {
            var result = await API.getLibraryItems(this.getCurrentFolderId(), params);
            if (token !== this._loadingToken) return;

            var incoming = result.Items || [];
            if (excludeItemTypes && incoming.length > 0) {
                incoming = incoming.filter(function(item) { return item.Type !== 'BoxSet'; });
            }

            this.totalCount = result.TotalRecordCount || incoming.length;

            if (isReset) {
                this.items = incoming;
            } else {
                var existing = {};
                for (var i = 0; i < this.items.length; i++) existing[this.items[i].Id] = true;
                for (var j = 0; j < incoming.length; j++) {
                    if (!existing[incoming[j].Id]) {
                        this.items.push(incoming[j]);
                        existing[incoming[j].Id] = true;
                    }
                }
            }
        } catch (e) {
            if (token !== this._loadingToken) return;
            console.error('[Moonfin] Failed to load library items:', e);
        }

        this.loading = false;
        this.render();
    },

    getVisibleItems: function() {
        if (!this.startLetter) return this.items;
        var letter = this.startLetter;
        return this.items.filter(function(item) {
            var name = item.Name || '';
            var firstChar = name.charAt(0).toUpperCase();
            if (letter === '#') return !/[A-Z]/.test(firstChar);
            return firstChar === letter;
        });
    },

    getCardShapeClass: function(item) {
        if (this.imageType === 'thumbnail') return 'type-landscape';
        if (this.imageType === 'square' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist' || item.Type === 'Audio') {
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

    getGridClass: function() {
        var directionClass = this.gridDirection === 'horizontal' ? 'moonfin-library-grid-horizontal' : 'moonfin-library-grid-vertical';
        var typeClass = this.imageType === 'thumbnail' ? 'type-landscape' : (this.imageType === 'square' ? 'type-square' : 'type-poster');
        return directionClass + ' size-' + this.imageSize + ' ' + typeClass;
    },

    formatRuntime: function(ticks) {
        if (!ticks) return '';
        var minutes = Math.floor(ticks / 600000000);
        if (minutes < 60) return minutes + 'm';
        var hours = Math.floor(minutes / 60);
        var mins = minutes % 60;
        return mins > 0 ? hours + 'h ' + mins + 'm' : hours + 'h';
    },

    buildFocusedInfoHtml: function() {
        if (!this.focusedItem) return '';
        var item = this.focusedItem;
        var parts = [];
        if (item.ProductionYear) parts.push('<span class="moonfin-library-meta-item">' + item.ProductionYear + '</span>');
        if (item.OfficialRating) parts.push('<span class="moonfin-library-meta-item">' + item.OfficialRating + '</span>');
        var runtime = this.formatRuntime(item.RunTimeTicks);
        if (runtime && item.Type !== 'Series') parts.push('<span class="moonfin-library-meta-item">' + runtime + '</span>');
        if (item.CommunityRating) parts.push('<span class="moonfin-library-meta-item">&#9733; ' + item.CommunityRating.toFixed(1) + '</span>');

        return '<div class="moonfin-library-focused">' +
            '<div class="moonfin-library-focused-name">' + (item.Name || '') + '</div>' +
            '<div class="moonfin-library-focused-meta">' + parts.join('') + '</div>' +
            '<div class="moonfin-library-focused-mdblist moonfin-mdblist-ratings-row">' + (this.focusedMdbHtml || '') + '</div>' +
        '</div>';
    },

    updateFocusedInfoDom: function() {
        if (!this.container) return;
        var focused = this.container.querySelector('.moonfin-library-focused');
        var nextHtml = this.buildFocusedInfoHtml();
        if (!nextHtml) {
            if (focused) focused.remove();
            return;
        }

        if (focused) {
            focused.outerHTML = nextHtml;
        } else {
            var header = this.container.querySelector('.moonfin-library-header');
            if (header) {
                header.insertAdjacentHTML('afterend', nextHtml);
            }
        }
    },

    loadFocusedMdbRatings: function(item) {
        if (!item || typeof MdbList === 'undefined' || !MdbList.isEnabled()) {
            return;
        }

        var token = ++this._focusedMdbToken;
        var self = this;

        MdbList.fetchRatings(item).then(function(ratings) {
            if (token !== self._focusedMdbToken) return;
            if (!self.focusedItem || self.focusedItem.Id !== item.Id) return;

            self.focusedMdbHtml = MdbList.buildRatingsHtml(ratings, 'compact') || '';
            var row = self.container ? self.container.querySelector('.moonfin-library-focused-mdblist') : null;
            if (row) {
                row.innerHTML = self.focusedMdbHtml;
            } else {
                self.updateFocusedInfoDom();
            }
        });
    },

    setFocusedItem: function(item) {
        if (!item) return;
        if (this.focusedItem && this.focusedItem.Id === item.Id) return;

        this.focusedItem = item;
        this.focusedMdbHtml = '';
        this._focusedMdbToken++;
        this.updateFocusedInfoDom();
        this.loadFocusedMdbRatings(item);
    },

    renderSortPanel: function() {
        if (!this.showSortPanel) return '';
        var options = this.getActiveSortOptions();
        var html = '';
        html += '<div class="moonfin-library-panel-overlay" data-action="close-sort-panel">';
        html += '  <div class="moonfin-library-side-panel" data-stop-prop="1">';
        html += '    <h2 class="moonfin-library-panel-title">Sort &amp; Filter</h2>';
        html += '    <div class="moonfin-library-panel-section">';
        html += '      <div class="moonfin-library-panel-label">Sort By</div>';
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var active = this.sortKey === opt.key ? ' active' : '';
            html += '<button class="moonfin-library-panel-option' + active + '" data-action="set-sort" data-sort-key="' + opt.key + '">' + opt.label + '</button>';
        }
        html += '    </div>';

        if (this.isMusicLibrary()) {
            html += '    <div class="moonfin-library-panel-section">';
            html += '      <div class="moonfin-library-panel-label">Show</div>';
            for (var m = 0; m < this.MUSIC_CONTENT_TYPES.length; m++) {
                var type = this.MUSIC_CONTENT_TYPES[m];
                var mActive = this.musicContentType === type.key ? ' active' : '';
                html += '<button class="moonfin-library-panel-option' + mActive + '" data-action="set-music-content" data-music-content="' + type.key + '">' + type.label + '</button>';
            }
            html += '    </div>';
        }

        html += '    <div class="moonfin-library-panel-section">';
        html += '      <div class="moonfin-library-panel-label">Filters</div>';
        html += '      <button class="moonfin-library-panel-option' + (this.favoritesOnly ? ' active' : '') + '" data-action="toggle-favorites">Favorites Only</button>';
        html += '      <button class="moonfin-library-panel-option' + (this.watchedOnly ? ' active' : '') + '" data-action="toggle-watched">Watched Only</button>';
        html += '    </div>';
        html += '  </div>';
        html += '</div>';
        return html;
    },

    renderSettingsPanel: function() {
        if (!this.showSettingsPanel) return '';
        var html = '';
        html += '<div class="moonfin-library-panel-overlay" data-action="close-settings-panel">';
        html += '  <div class="moonfin-library-side-panel" data-stop-prop="1">';
        html += '    <div class="moonfin-library-settings-header">LIBRARIES</div>';
        html += '    <h2 class="moonfin-library-panel-title">' + this.libraryName + '</h2>';
        html += '    <button class="moonfin-library-setting-row" data-action="cycle-image-size"><span>Image size</span><b>' + this.capitalize(this.imageSize) + '</b></button>';
        if (this.shouldShowImageTypeOption()) {
            html += '    <button class="moonfin-library-setting-row" data-action="cycle-image-type"><span>Image type</span><b>' + this.capitalize(this.imageType) + '</b></button>';
        }
        html += '    <button class="moonfin-library-setting-row" data-action="cycle-grid-direction"><span>Grid direction</span><b>' + this.capitalize(this.gridDirection) + '</b></button>';
        html += '    <button class="moonfin-library-setting-row" data-action="toggle-folder-view"><span>Folder view</span><b>' + (this.folderView ? 'On' : 'Off') + '</b></button>';
        html += '  </div>';
        html += '</div>';
        return html;
    },

    capitalize: function(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    },

    renderBreadcrumb: function() {
        if (!this.folderView || this.folderStack.length === 0) return '';
        var html = '<div class="moonfin-library-breadcrumb">';
        html += '<button class="moonfin-library-breadcrumb-item" data-action="breadcrumb" data-depth="0">' + this.libraryName + '</button>';
        for (var i = 0; i < this.folderStack.length; i++) {
            var seg = this.folderStack[i];
            html += '<span class="moonfin-library-breadcrumb-sep">&#8250;</span>';
            if (i < this.folderStack.length - 1) {
                html += '<button class="moonfin-library-breadcrumb-item" data-action="breadcrumb" data-depth="' + (i + 1) + '">' + seg.name + '</button>';
            } else {
                html += '<span class="moonfin-library-breadcrumb-current">' + seg.name + '</span>';
            }
        }
        html += '</div>';
        return html;
    },

    render: function() {
        if (!this.container) return;
        var visibleItems = this.getVisibleItems();
        var sortOption = this.getSortOption();
        var statusText = this.folderView
            ? 'Browsing folders sorted by ' + sortOption.label
            : 'Showing items from ' + this.libraryName + ' sorted by ' + sortOption.label;

        var html = '';
        html += '<div class="moonfin-genres-header moonfin-library-header">';
        if (this.folderView && this.folderStack.length > 0) {
            html += this.renderBreadcrumb();
            html += '<span class="moonfin-genres-count">' + this.totalCount + ' items</span>';
        } else {
            html += '<div class="moonfin-genres-title-section">';
            html += '  <h1 class="moonfin-genres-title">' + this.libraryName + '</h1>';
            html += '  <span class="moonfin-genres-count">' + this.totalCount + ' items</span>';
            html += '</div>';
        }
        html += '</div>';

        html += this.buildFocusedInfoHtml();

        html += '<div class="moonfin-genres-toolbar moonfin-library-toolbar">';
        html += '  <button class="moonfin-genres-header-btn" data-action="home" title="Home"><span class="material-icons">home</span></button>';
        html += '  <button class="moonfin-genres-header-btn" data-action="toggle-sort-panel" title="Sort"><span class="material-icons">sort</span></button>';
        html += '  <button class="moonfin-genres-header-btn" data-action="toggle-settings-panel" title="Settings"><span class="material-icons">settings</span></button>';
        html += '  <div class="moonfin-genres-letter-nav moonfin-library-letter-nav">';
        for (var i = 0; i < this.LETTERS.length; i++) {
            var letter = this.LETTERS[i];
            html += '<button class="moonfin-genres-letter-btn' + (this.startLetter === letter ? ' active' : '') + '" data-action="letter" data-letter="' + letter + '">' + letter + '</button>';
        }
        html += '  </div>';
        html += '</div>';

        if (this.loading && visibleItems.length === 0) {
            html += '<div class="moonfin-genres-loading"><div class="moonfin-genres-spinner"></div></div>';
        } else if (visibleItems.length === 0) {
            html += '<div class="moonfin-genres-empty">No items found</div>';
        } else {
            html += '<div class="moonfin-genres-browse-grid moonfin-library-grid ' + this.getGridClass() + '" data-action="grid">';
            for (var j = 0; j < visibleItems.length; j++) {
                var item = visibleItems[j];
                var shapeClass = this.getCardShapeClass(item);
                var imageType = this.imageType === 'thumbnail' ? 'Thumb' : 'Primary';
                var posterUrl = imageType === 'Thumb'
                    ? (item.ImageTags && item.ImageTags.Thumb ? API.getImageUrl(item, 'Thumb', { maxWidth: 500 }) : null)
                    : API.getPrimaryImageUrl(item, { maxWidth: 500 });
                if (!posterUrl) {
                    posterUrl = API.getBackdropUrl(item, { maxWidth: 500 });
                }

                html += '<div class="moonfin-genre-item-card moonfin-library-item-card ' + shapeClass + ' size-' + this.imageSize + '" data-item-id="' + item.Id + '">';
                html += '  <div class="moonfin-genre-item-poster" style="height:' + this.getPosterHeight() + 'px">';
                if (posterUrl) {
                    html += '    <img src="' + posterUrl + '" alt="' + (item.Name || '').replace(/"/g, '&quot;') + '" loading="lazy">';
                } else {
                    html += '    <div class="moonfin-genre-item-no-poster"><span class="material-icons">movie</span></div>';
                }
                if (this.folderView && item.IsFolder) {
                    html += '    <span class="moonfin-library-folder-badge">Folder</span>';
                }
                if (item.UserData && item.UserData.IsFavorite) {
                    html += '    <span class="moonfin-library-favorite-badge">&#10084;</span>';
                }
                html += '  </div>';
                html += '  <div class="moonfin-genre-item-info"><div class="moonfin-genre-item-name">' + (item.Name || 'Unknown') + '</div></div>';
                html += '</div>';
            }
            html += '</div>';
        }

        html += '<div class="moonfin-library-status-bar">';
        html += '<div class="moonfin-library-status-text">' + statusText + '</div>';
        html += '<div class="moonfin-library-status-count">' + visibleItems.length + ' | ' + this.totalCount + '</div>';
        html += '</div>';

        html += this.renderSortPanel();
        html += this.renderSettingsPanel();

        this.container.innerHTML = html;
        this.bindEvents();
    },

    findItemById: function(itemId) {
        for (var i = 0; i < this.items.length; i++) {
            if (this.items[i].Id === itemId) return this.items[i];
        }
        return null;
    },

    handleItemOpen: function(item) {
        if (!item) return;
        if (this.folderView && item.IsFolder) {
            this.folderStack.push({ id: item.Id, name: item.Name || 'Folder' });
            this.loadItems(true);
            return;
        }

        if (item.Type === 'BoxSet' || item.Type === 'Playlist') {
            this.show(item.Id, item.Name || 'Collection', 'collection', { sortKey: 'PremiereDate' });
            return;
        }

        var type = item.Type || null;
        var supportsMoonfinDetails = type === 'Movie' || type === 'Series' || type === 'Episode' || type === 'Season' || type === 'Person';
        if (supportsMoonfinDetails && typeof Details !== 'undefined' && Storage.get('detailsPageEnabled')) {
            Details.showDetails(item.Id, type);
            return;
        }

        API.navigateToItem(item.Id);
        this.close();
    },

    bindEvents: function() {
        var self = this;

        if (this._clickHandler) {
            this.container.removeEventListener('click', this._clickHandler);
            this._clickHandler = null;
        }

        this._clickHandler = function(e) {
            var target = e.target.closest('[data-action], .moonfin-genre-item-card, .moonfin-library-panel-overlay');
            if (!target) return;

            if (target.getAttribute('data-stop-prop') === '1') return;

            var action = target.getAttribute('data-action');
            if (!action && target.classList.contains('moonfin-genre-item-card')) {
                action = 'open-item';
            }

            switch (action) {
                case 'home':
                    self.close();
                    API.navigateTo('/home');
                    break;
                case 'toggle-sort-panel':
                    self.showSortPanel = !self.showSortPanel;
                    self.showSettingsPanel = false;
                    self.render();
                    break;
                case 'toggle-settings-panel':
                    self.showSettingsPanel = !self.showSettingsPanel;
                    self.showSortPanel = false;
                    self.render();
                    break;
                case 'close-sort-panel':
                    self.showSortPanel = false;
                    self.render();
                    break;
                case 'close-settings-panel':
                    self.showSettingsPanel = false;
                    self.render();
                    break;
                case 'set-sort':
                    self.sortKey = target.getAttribute('data-sort-key') || self.sortKey;
                    self.saveViewPrefs();
                    self.showSortPanel = false;
                    self.loadItems(true);
                    break;
                case 'set-music-content':
                    self.musicContentType = target.getAttribute('data-music-content') || self.musicContentType;
                    self.saveViewPrefs();
                    self.loadItems(true);
                    break;
                case 'toggle-favorites':
                    self.favoritesOnly = !self.favoritesOnly;
                    self.loadItems(true);
                    break;
                case 'toggle-watched':
                    self.watchedOnly = !self.watchedOnly;
                    self.loadItems(true);
                    break;
                case 'letter':
                    var letter = target.getAttribute('data-letter');
                    self.startLetter = self.startLetter === letter ? null : letter;
                    self.loadItems(true);
                    break;
                case 'cycle-image-size':
                    self.imageSize = self.imageSize === 'small' ? 'medium' : (self.imageSize === 'medium' ? 'large' : 'small');
                    self.saveViewPrefs();
                    self.render();
                    break;
                case 'cycle-image-type':
                    if (self.shouldShowImageTypeOption()) {
                        self.imageType = self.imageType === 'poster' ? 'thumbnail' : 'poster';
                        self.saveViewPrefs();
                        self.render();
                    }
                    break;
                case 'cycle-grid-direction':
                    self.gridDirection = self.gridDirection === 'vertical' ? 'horizontal' : 'vertical';
                    self.saveViewPrefs();
                    self.render();
                    break;
                case 'toggle-folder-view':
                    self.folderView = !self.folderView;
                    self.folderStack = [];
                    self.saveViewPrefs();
                    self.loadItems(true);
                    break;
                case 'breadcrumb':
                    var depth = parseInt(target.getAttribute('data-depth') || '0', 10);
                    if (!isNaN(depth)) {
                        self.folderStack = self.folderStack.slice(0, Math.max(0, depth));
                        self.loadItems(true);
                    }
                    break;
                case 'open-item':
                    var itemId = target.getAttribute('data-item-id');
                    self.handleItemOpen(self.findItemById(itemId));
                    break;
            }
        };
        this.container.addEventListener('click', this._clickHandler);

        if (this._mouseoverHandler) {
            this.container.removeEventListener('mouseover', this._mouseoverHandler);
            this._mouseoverHandler = null;
        }

        this._mouseoverHandler = function(e) {
            var card = e.target.closest('.moonfin-genre-item-card');
            if (!card || !self.container.contains(card)) return;
            if (e.relatedTarget && card.contains(e.relatedTarget)) return;

            var item = self.findItemById(card.getAttribute('data-item-id'));
            self.setFocusedItem(item);
        };
        this.container.addEventListener('mouseover', this._mouseoverHandler);

        if (this._focusinHandler) {
            this.container.removeEventListener('focusin', this._focusinHandler);
            this._focusinHandler = null;
        }

        this._focusinHandler = function(e) {
            var card = e.target.closest('.moonfin-genre-item-card');
            if (!card || !self.container.contains(card)) return;

            var item = self.findItemById(card.getAttribute('data-item-id'));
            self.setFocusedItem(item);
        };
        this.container.addEventListener('focusin', this._focusinHandler);

        if (this._escHandler) {
            document.removeEventListener('keydown', this._escHandler);
        }

        if (this._scrollHandler) {
            this.container.removeEventListener('scroll', this._scrollHandler);
            this._scrollHandler = null;
        }

        this._scrollHandler = function() {
            if (self.loading) return;
            if (self.startLetter) return;
            if (self.items.length >= self.totalCount) return;
            var scrollTop = self.container.scrollTop;
            var scrollHeight = self.container.scrollHeight;
            var clientHeight = self.container.clientHeight;
            if (scrollTop + clientHeight >= scrollHeight - 400) {
                self.startIndex = self.items.length;
                self.loadItems(false);
            }
        };
        this.container.addEventListener('scroll', this._scrollHandler);

        this._escHandler = function(e) {
            if (e.key === 'Escape' && self.isVisible) {
                e.preventDefault();
                e.stopPropagation();
                self.hide();
            }
        };
        document.addEventListener('keydown', this._escHandler);
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
        if (this._clickHandler && this.container) {
            this.container.removeEventListener('click', this._clickHandler);
            this._clickHandler = null;
        }
        if (this._mouseoverHandler && this.container) {
            this.container.removeEventListener('mouseover', this._mouseoverHandler);
            this._mouseoverHandler = null;
        }
        if (this._focusinHandler && this.container) {
            this.container.removeEventListener('focusin', this._focusinHandler);
            this._focusinHandler = null;
        }
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        document.body.classList.remove('moonfin-library-visible');
        this.isVisible = false;
    }
};
