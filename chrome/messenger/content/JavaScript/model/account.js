var gPrefService = Components.classes["@mozilla.org/preferences;1"].
    getService(Components.interfaces.nsIPrefBranch2);

function presenceToIcon(show)
{
    if (!show || show == "unavailable")
        return account.iconSet+"offline.png";
    return account.iconSet + (show == "available" ? "online" : show) + ".png";
}

function Account()
{
    this.groups = []
    this.allGroups = {}
    this.contacts = {};
    this.allContacts = {};
    this.resources = {};
    this.conferences = [];
    this.allConferences = {};
    this._presenceObservers = [];
    this.currentPresence = {show: "unavailable"};

    this.cache = new PersistantCache("oneteamCache");
    this.historyMgr = new HistoryManager();
    this.bookmarks = new ConferenceBookmarks();
    this.presenceProfiles = new PresenceProfiles();
    this.connected = false;

    this.init();

    self.account = this;

    // XXX use string bundle
    this.defaultGroup = new Group(null, "Contacts", true);

    this.connectionInfo = {};
    this.notificationScheme = new NotificationScheme();

    this.observe(null, null, "chat.connection.host");
    this.observe(null, null, "chat.connection.port");
    this.observe(null, null, "chat.connection.base");
    this.observe(null, null, "chat.connection.port");
    this.observe(null, null, "chat.connection.user");
    this.observe(null, null, "chat.connection.pass");

    this.observe(null, null, "chat.general.iconsetdir");

    gPrefService.addObserver("chat.connection", this, false);
    gPrefService.addObserver("chat.general", this, false);
}

_DECL_(Account, null, Model, DiscoItem).prototype =
{
    bumpPriority: true,

    getPresenceFor: function(contact)
    {
        var presence = this.currentPresence.profile ?
            this.currentPresence.profile.getPresenceFor(contact) :
            this.currentPresence;

        return [presence.show, presence.status, presence.priority];
    },

    setPresence: function(show, status, priority, profile, userSet)
    {
        var presence, newPresence;

        if (show instanceof Object)
            newPresence = show;
        else
            newPresence = {show: show, status: status, priority: priority,
                           profile: profile};

        if (!newPresence.priority)
            newPresence.priority = gPrefService.getIntPref("chat.connection.priority");

        if (!newPresence.profile) {
            presence = new JSJaCPresence();
            if (newPresence.show)
                presence.setShow(newPresence.show);
            if (newPresence.status)
                presence.setStatus(newPresence.status);
            presence.setPriority(newPresence.priority);

            for (var i = 0; i < this._presenceObservers.length; i++)
                this._presenceObservers[i]._sendPresence(newPresence.show,
                                                         newPresence.status,
                                                         newPresence.priority);

            con.send(presence);
            this.currentPresence = newPresence;
            if (userSet)
                this.userPresence = newPresence;

            this.modelUpdated("currentPresence");

            return;
        }

        for (var c in this.contactsIterator()) {
            if (presence = profile.getPresenceFor(c)) {
                if (profile != this.currentPresence.profile)
                    c._sendPresence(presence.show, presence.status, presence.priority);
            } else
                c._sendPresence(newPresence.show, newPresence.status, newPresence.priority);
        }

        for (var i = 0; i < this._presenceObservers.length; i++)
            if (presence = profile.getPresenceFor(this._presenceObservers[i])) {
                if (profile != this.currentPresence.profile)
                    this._presenceObservers[i]._sendPresence(presence.show,
                                                             presence.status,
                                                             presence.priority);
            } else
                this._presenceObservers[i]._sendPresence(newPresence.show,
                                                         newPresence.status,
                                                         newPresence.priority);
        this.currentPresence = newPresence;
        if (userSet)
            this.userPresence = newPresence;

        this.modelUpdated("currentPresence");
    },

    groupsIterator: function(predicate, token)
    {
        for (var i = 0; i < this.groups.length; i++)
            if (!predicate || predicate(this.groups[i], token))
                yield this.groups[i];
    },

    contactsIterator: function(predicate, token)
    {
        for each (var contact in this.contacts)
            if (!predicate || predicate(contact, token))
                yield contact;
    },

    _onGroupAdded: function(group)
    {
        this.groups.push(group);
        this.modelUpdated("groups", {added: [group]});
    },

    _onGroupRemoved: function(group)
    {
        this.groups.splice(this.groups.indexOf(group), 1);
        this.modelUpdated("groups", {removed: [group]});
    },

    getOrCreateGroup: function(name)
    {
        if (this.allGroups[name])
            return this.allGroups[name];
        return new Group(name);
    },

    getOrCreateContact: function(jid, name, groups)
    {
        if (this.allContacts[jid])
            return this.allContacts[jid];
        if (this.allConferences[jid])
            return this.allConferences[jid];
        return new Contact(jid, name, groups, null, null, true);
    },

    getOrCreateResource: function(jid)
    {
        if (this.resources[jid])
            return this.resources[jid];

        jid = new JID(jid);
        if (this.allContacts[jid.shortJID])
            return this.allContacts[jid.shortJID].createResource(jid);
        else if (this.allConferences[jid.shortJID])
            return this.allConferences[jid.shortJID].createResource(jid);
    },

    _onConferenceAdded: function(conference)
    {
        this.conferences.push(conference);
        this.modelUpdated("conferences", {added: [conference]});
    },

    _onConferenceRemoved: function(conference)
    {
        this.conferences.splice(this.conferences.indexOf(conference), 1);
        this.modelUpdated("conferences", {removed: [conference]});
    },

    getOrCreateConference: function(jid)
    {
        if (this.allConferences[jid])
            return this.allConferences[jid];
        return new Conference(jid);
    },

    onAddContact: function(contact)
    {
        openDialogUniq("ot:addContact", "addContact.xul",
                       "chrome,centerscreen,modal", contact);
    },

    onJoinRoom: function(bookmark)
    {
        openDialogUniq("ot:joinRoom", "joinRoom.xul",
                       "chrome,centerscreen,modal", bookmark);
    },

    onManageBookmarks: function()
    {
        openDialogUniq("ot:manageBookmarks", "manageBookmarks.xul",
                       "chrome,centerscreen,modal");
    },

    showHistoryManager: function()
    {
        openDialogUniq("ot:history", "history.xul", "chrome,centerscreen,dialog=no");
    },

    showTransfersManager: function()
    {
        openDialogUniq("ot:fileTransfers", "fileTransfers.xul",
                       "chrome,centerscreen,dialog=no");
    },

    showAbout: function()
    {
        openDialogUniq("ot:about", "about.xul", "chrome,centerscreen");
    },

    showPrefs: function()
    {
        openDialogUniq("ot:settings", "settings.xul", "chrome,centerscreen");
    },

    showVCard: function()
    {
        openDialogUniq("ot:myInfo", "myInfo.xul", "chrome,centerscreen,dialog=no");
    },

    showConsole: function()
    {
        openDialogUniq("ot:console", "console.xul", "chrome,centerscreen,dialog=no");
    },

    showDisco: function()
    {
        openDialogUniq("ot:disco", "disco.xul", "chrome,centerscreen,dialog=no");
    },

    onCustomPresence: function(presence)
    {
        openDialogUniq("ot:status", "status.xul", "chrome,centerscreen,modal",
                       presence);
    },

    onEditPresenceProfiles: function()
    {
        openDialogUniq("ot:presenceProfiles", "presenceProfiles.xul",
                       "chrome,centerscreen,modal");
    },

    observe: function(subject, topic, value)
    {
        var val;
        try {
            if ((val = value.replace(/^chat\.connection\./, "")) != value) {
                switch (val) {
                case "host":
                case "base":
                case "user":
                    this.connectionInfo[val] = gPrefService.getCharPref(value);
                    break;
                case "pass":
                    if (gPrefService.getCharPref(value))
                        this.connectionInfo[val] = gPrefService.getCharPref(value);
                    break;
                case "port":
                    this.connectionInfo[val] = gPrefService.getIntPref(value);
                    break;
                case "polling":
                    this.connectionInfo[val] = gPrefService.getBoolPref(value);
                    break;
                }
                this.modelUpdated("connectionInfo");
            } else if (value == "chat.general.iconsetdir") {
                this.iconSet = "chrome://messenger/content/img/" +
                    gPrefService.getCharPref(value) + "/";
                this.modelUpdated("iconSet");
            }
        } catch (ex) {}
    },

    setUserAndPass: function(user, pass, savePass)
    {
        gPrefService.setCharPref("chat.connection.user", user);
        if (savePass)
            gPrefService.setCharPref("chat.connection.pass", pass);
        else
            gPrefService.clearUserPref("chat.connection.pass");
        this.connectionInfo.pass = pass;
    },

    connect: function()
    {
        var args = {
            httpbase: "http://"+this.connectionInfo.host+":"+this.connectionInfo.port+
                "/"+this.connectionInfo.base+"/",
            timerval: 2000};

        var con = this.connectionInfo.polling ? new JSJaCHttpBindingConnection(args) :
            new JSJaCHttpPollingConnection(args);

        con.registerHandler("message", function(p){account.onMessage(p)});
        con.registerHandler("presence", function(p){account.onPresence(p)});
        con.registerHandler("iq", function(p){account.onIQ(p)});
        con.registerHandler("onconnect", function(p){account.onConnect(p)});
        con.registerHandler("ondisconnect", function(p){account.onDisconnect(p)});
        con.registerHandler('onerror', function(p){account.onError(p)});

        args = {
            domain: this.connectionInfo.host,
            username: this.connectionInfo.user,
            pass: this.connectionInfo.pass,
            resource: gPrefService.getCharPref("chat.connection.resource")};

        self.con = con;
        this.modelUpdated("con");
        con.connect(args);
    },

    onConnect: function()
    {
        var pkt = new JSJaCIQ();
        pkt.setIQ(null, null, 'get');
        pkt.setQuery('jabber:iq:roster');
        con.send(pkt);

        this.connected = true;

        this.myJID = new JID(con.fulljid);
        this.discoJID = new JID(this.myJID.domain);

        if (this.userPresence)
            this.setPresence(this.userPresence);
        else
            this.setPresence();

        this.modelUpdated("connected");

        this.bookmarks.retrieve();
        this.getDiscoItemsByCategory("conference", "text", false,
                                     function(items) {
                                        if (items.length)
                                           account.defaultConferenceServer = items[0].jid;
                                     });
        this.presenceProfiles.loadFromServer();
    },

    onDisconnect: function()
    {
        this.connected = false;
        self.con = null;

        this.modelUpdated("con", null, "connected");

        var groups = this.groups;
        var conferences = this.conferences;

        this.groups = []
        this.allGroups = {}
        this.contacts = {};
        this.allContacts = {};
        this.resources = {};
        this.conferences = [];
        this.allConferences = {};

        this.modelUpdated("groups", {removed: groups});
        this.modelUpdated("conferences", {removed: conferences});

        this.bookmarks._clean();
        for (var i = 0; i < groups.length; i++)
            if (groups[i].builtinGroup)
                groups[i]._clean();
    },

    onPresence: function(packet)
    {
        var sender = new JID(packet.getFrom());

        if (this.myJID.shortJID == sender.shortJID) {
            if (this.bumpPriority) {
                var tag = packet.getNode().getElementsByTagName('priority');

                if (+tag[0].textContent > this.currentPresence.priority)
                    window.openDialog("chrome://messenger/content/changePriority.xul", "_blank",
                                      "chrome,centerscreen", this);
            }
            return;
        }

        //Handle subscription requests
        switch (packet.getType()) {
        case "subscribe": 
            window.openDialog("chrome://messenger/content/subscribe.xul", "_blank",
                              "chrome,centerscreen,resizable", this.getOrCreateContact(sender),
                              packet.getStatus());
            return;
        case "subscribed":
        case "unsubscribe":
        case "unsubscribed":
            this.notificationScheme.show("subscription", packet.getType(),
                                         this.allContacts[sender.shortJID] || sender);
            return;
        }

        // Delegate rest to respective handlers
        var item = sender.resource ? this.getOrCreateResource(sender) :
            this.conferences[sender];

        if (item)
            item.onPresence(packet);
    },

    onIQ: function(packet)
    {
        var ns, query = packet.getNode().childNodes;

        for (var i = 0; i < query.length; i++)
            if (query[i].nodeType == 1) {
                query = query[i];
                break;
            }
        if (!query.nodeType)
            return;

        switch (ns = query.namespaceURI) {
        case "jabber:iq:roster":
            var items = query.getElementsByTagNameNS(ns, "item");
            for (i = 0; i < items.length; i++) {
                var jid = items[i].getAttribute("jid");

                if (this.allContacts[jid])
                    this.allContacts[jid]._updateFromServer(items[i]);
                else
                    new Contact(items[i]);
            }
            break;
        case "http://jabber.org/protocol/si":
            fileTransferService.onIQ(packet);
            break;
        case "http://jabber.org/protocol/bytestreams":
            socks5Service.onIQ(packet);
            break;
        }
    },

    onMessage: function(packet)
    {
        var sender = new JID(packet.getFrom());
        var invite = packet.getNode().
                getElementsByTagNameNS("http://jabber.org/protocol/muc#user", "invite")[0];

        if (invite) {
            var conference = this.getOrCreateConference(sender);
            var reason = invite.getElementsByTagName("reason")[0];

            if (conference.joined)
                return;

            window.openDialog("chrome://messenger/content/invitation.xul", "ot:invitation",
                              "chrome,centerscreen", conference,
                              new JID(invite.getAttribute("from")),
                              reason && reason.textContent);
            return;
        }

        // Message come from me
        if (sender == this.myJID)
            return;

        var item = sender.resource ? this.getOrCreateResource(sender) :
            this.getOrCreateContact(sender);

        if (!item)
            item = this.getOrCreateContact(sender.getShortJID());

        item.onMessage(packet);
    }
}

account = new Account();
//account.showConsole();

