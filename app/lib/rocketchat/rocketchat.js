import { Q } from '@nozbe/watermelondb';
import AsyncStorage from '@react-native-community/async-storage';
import { InteractionManager } from 'react-native';
import { setActiveUsers } from '../../actions/activeUsers';
import { setUser } from '../../actions/login';
import defaultSettings from '../../constants/settings';
import { getDeviceToken } from '../../notifications/push';
import log from '../../utils/log';
import database from '../database';
import triggerBlockAction, { triggerCancel, triggerSubmitView } from '../methods/actions';
import callJitsi, { callJitsiWithoutServer } from '../methods/callJitsi';
import canOpenRoom from '../methods/canOpenRoom';
import {
	getEnterpriseModules,
	hasLicense,
	isOmnichannelModuleAvailable,
	setEnterpriseModules
} from '../methods/enterpriseModules';
import { getCustomEmojis, setCustomEmojis } from '../methods/getCustomEmojis';
import { getPermissions, setPermissions } from '../methods/getPermissions';
import { getRoles, setRoles } from '../methods/getRoles';
import getRooms from '../methods/getRooms';
import getSettings, { getLoginSettings, setSettings, subscribeSettings } from '../methods/getSettings';
import getSlashCommands from '../methods/getSlashCommands';
import loadMessagesForRoom from '../methods/loadMessagesForRoom';
import loadMissedMessages from '../methods/loadMissedMessages';
import loadNextMessages from '../methods/loadNextMessages';
import loadSurroundingMessages from '../methods/loadSurroundingMessages';
import loadThreadMessages from '../methods/loadThreadMessages';
import logout, { removeServer } from '../methods/logout';
import readMessages from '../methods/readMessages';
import { cancelUpload, isUploadActive, sendFileMessage } from '../methods/sendFileMessage';
import sendMessage, { resendMessage } from '../methods/sendMessage';
import subscribeRooms from '../methods/subscriptions/rooms';
import UserPreferences from '../userPreferences';
import { compareServerVersion } from '../utils';
import { getUserPresence, subscribeUsersPresence } from '../methods/getUsersPresence';
import { store as reduxStore } from '../auxStore';
// Methods
import clearCache from './methods/clearCache';
import getPermalinkMessage from './methods/getPermalinkMessage';
import getRoom from './methods/getRoom';
import isGroupChat from './methods/isGroupChat';
import roomTypeToApiType from './methods/roomTypeToApiType';
import getUserInfo from './services/getUserInfo';
import * as search from './methods/search';
// Services
import sdk from './services/sdk';
import toggleFavorite from './services/toggleFavorite';
import {
	login,
	loginTOTP,
	loginWithPassword,
	loginOAuthOrSso,
	getLoginServices,
	determineAuthType,
	disconnect,
	checkAndReopen,
	abort,
	getServerInfo,
	getWebsocketInfo,
	stopListener,
	connect
} from './services/connect';
import { shareExtensionInit, closeShareExtension } from './services/shareExtension';
import * as restApis from './services/restApi';

const TOKEN_KEY = 'reactnativemeteor_usertoken';
const CURRENT_SERVER = 'currentServer';
const SORT_PREFS_KEY = 'RC_SORT_PREFS_KEY';
const CERTIFICATE_KEY = 'RC_CERTIFICATE_KEY';
export const THEME_PREFERENCES_KEY = 'RC_THEME_PREFERENCES_KEY';
export const CRASH_REPORT_KEY = 'RC_CRASH_REPORT_KEY';
export const ANALYTICS_EVENTS_KEY = 'RC_ANALYTICS_EVENTS_KEY';
export const MIN_ROCKETCHAT_VERSION = '0.70.0';
export const STATUSES = ['offline', 'online', 'away', 'busy'];

const RocketChat = {
	TOKEN_KEY,
	CURRENT_SERVER,
	CERTIFICATE_KEY,
	...restApis,
	...search,
	callJitsi,
	callJitsiWithoutServer,
	async subscribeRooms() {
		if (!this.roomsSub) {
			try {
				this.roomsSub = await subscribeRooms.call(this);
			} catch (e) {
				log(e);
			}
		}
	},
	unsubscribeRooms() {
		if (this.roomsSub) {
			this.roomsSub.stop();
			this.roomsSub = null;
		}
	},
	canOpenRoom,
	getWebsocketInfo,
	getServerInfo,
	stopListener,
	// Abort all requests and create a new AbortController
	abort,
	checkAndReopen,
	disconnect,
	connect,
	shareExtensionInit,
	closeShareExtension,
	loginTOTP,
	loginWithPassword,
	loginOAuthOrSso,
	login,
	logout,
	logoutOtherLocations() {
		const { id: userId } = reduxStore.getState().login.user;
		return this.sdk.post('users.removeOtherTokens', { userId });
	},
	removeServer,
	clearCache,
	loadMissedMessages,
	loadMessagesForRoom,
	loadSurroundingMessages,
	loadNextMessages,
	loadThreadMessages,
	sendMessage,
	getRooms,
	readMessages,
	resendMessage,
	triggerBlockAction,
	triggerSubmitView,
	triggerCancel,
	sendFileMessage,
	cancelUpload,
	isUploadActive,
	getSettings,
	getLoginSettings,
	setSettings,
	subscribeSettings,
	getPermissions,
	setPermissions,
	getCustomEmojis,
	setCustomEmojis,
	getEnterpriseModules,
	setEnterpriseModules,
	hasLicense,
	isOmnichannelModuleAvailable,
	getSlashCommands,
	getRoles,
	setRoles,
	parseSettings: settings =>
		settings.reduce((ret, item) => {
			ret[item._id] = defaultSettings[item._id] && item[defaultSettings[item._id].type];
			if (item._id === 'Hide_System_Messages') {
				ret[item._id] = ret[item._id].reduce(
					(array, value) => [...array, ...(value === 'mute_unmute' ? ['user-muted', 'user-unmuted'] : [value])],
					[]
				);
			}
			return ret;
		}, {}),
	_prepareSettings(settings) {
		return settings.map(setting => {
			setting[defaultSettings[setting._id].type] = setting.value;
			return setting;
		});
	},
	getRoom,
	getPermalinkMessage,
	getPermalinkChannel(channel) {
		const { server } = reduxStore.getState().server;
		const roomType = {
			p: 'group',
			c: 'channel',
			d: 'direct'
		}[channel.t];
		return `${server}/${roomType}/${channel.name}`;
	},
	subscribe(...args) {
		return sdk.subscribe(...args);
	},
	subscribeRaw(...args) {
		return sdk.subscribeRaw(...args);
	},
	subscribeRoom(...args) {
		return sdk.subscribeRoom(...args);
	},
	unsubscribe(subscription) {
		return sdk.unsubscribe(subscription);
	},
	onStreamData(...args) {
		return sdk.onStreamData(...args);
	},
	toggleFavorite,
	methodCallWrapper(method, ...params) {
		return sdk.methodCallWrapper(method, ...params);
	},
	getUserInfo,
	getUidDirectMessage(room) {
		const { id: userId } = reduxStore.getState().login.user;

		if (!room) {
			return false;
		}

		// legacy method
		if (!room?.uids && room.rid && room.t === 'd') {
			return room.rid.replace(userId, '').trim();
		}

		if (RocketChat.isGroupChat(room)) {
			return false;
		}

		const me = room.uids?.find(uid => uid === userId);
		const other = room.uids?.filter(uid => uid !== userId);

		return other && other.length ? other[0] : me;
	},

	isRead(item) {
		let isUnread = item.archived !== true && item.open === true; // item is not archived and not opened
		isUnread = isUnread && (item.unread > 0 || item.alert === true); // either its unread count > 0 or its alert
		return !isUnread;
	},
	isGroupChat,
	post(...args) {
		return sdk.post(...args);
	},
	methodCall(...args) {
		return sdk.methodCall(...args);
	},
	hasRole(role) {
		const shareUser = reduxStore.getState().share.user;
		const loginUser = reduxStore.getState().login.user;
		// get user roles on the server from redux
		const userRoles = shareUser?.roles || loginUser?.roles || [];

		return userRoles.indexOf(r => r === role) > -1;
	},
	/**
	 * Permissions: array of permissions' roles from redux. Example: [['owner', 'admin'], ['leader']]
	 * Returns an array of boolean for each permission from permissions arg
	 */
	async hasPermission(permissions, rid) {
		let roomRoles = [];
		if (rid) {
			const db = database.active;
			const subsCollection = db.get('subscriptions');
			try {
				// get the room from database
				const room = await subsCollection.find(rid);
				// get room roles
				roomRoles = room.roles || [];
			} catch (error) {
				console.log('hasPermission -> Room not found');
				return permissions.map(() => false);
			}
		}

		try {
			const shareUser = reduxStore.getState().share.user;
			const loginUser = reduxStore.getState().login.user;
			// get user roles on the server from redux
			const userRoles = shareUser?.roles || loginUser?.roles || [];
			const mergedRoles = [...new Set([...roomRoles, ...userRoles])];
			return permissions.map(permission => permission?.some(r => mergedRoles.includes(r) ?? false));
		} catch (e) {
			log(e);
		}
	},
	async getAllowCrashReport() {
		const allowCrashReport = await AsyncStorage.getItem(CRASH_REPORT_KEY);
		if (allowCrashReport === null) {
			return true;
		}
		return JSON.parse(allowCrashReport);
	},
	async getAllowAnalyticsEvents() {
		const allowAnalyticsEvents = await AsyncStorage.getItem(ANALYTICS_EVENTS_KEY);
		if (allowAnalyticsEvents === null) {
			return true;
		}
		return JSON.parse(allowAnalyticsEvents);
	},
	getSortPreferences() {
		return UserPreferences.getMap(SORT_PREFS_KEY);
	},
	saveSortPreference(param) {
		let prefs = RocketChat.getSortPreferences();
		prefs = { ...prefs, ...param };
		return UserPreferences.setMap(SORT_PREFS_KEY, prefs);
	},
	getLoginServices,
	determineAuthType,
	roomTypeToApiType,
	_setUser(ddpMessage) {
		this.activeUsers = this.activeUsers || {};
		const { user } = reduxStore.getState().login;

		if (ddpMessage.fields && user && user.id === ddpMessage.id) {
			reduxStore.dispatch(setUser(ddpMessage.fields));
		}

		if (ddpMessage.cleared && user && user.id === ddpMessage.id) {
			reduxStore.dispatch(setUser({ status: { status: 'offline' } }));
		}

		const serverVersion = reduxStore.getState().server.version;
		if (compareServerVersion(serverVersion, 'lowerThan', '4.1.0')) {
			if (!this._setUserTimer) {
				this._setUserTimer = setTimeout(() => {
					const activeUsersBatch = this.activeUsers;
					InteractionManager.runAfterInteractions(() => {
						reduxStore.dispatch(setActiveUsers(activeUsersBatch));
					});
					this._setUserTimer = null;
					return (this.activeUsers = {});
				}, 10000);
			}
		}

		if (!ddpMessage.fields) {
			this.activeUsers[ddpMessage.id] = { status: 'offline' };
		} else if (ddpMessage.fields.status) {
			this.activeUsers[ddpMessage.id] = { status: ddpMessage.fields.status };
		}
	},
	getUserPresence,
	subscribeUsersPresence,
	canAutoTranslate() {
		try {
			const { AutoTranslate_Enabled } = reduxStore.getState().settings;
			if (!AutoTranslate_Enabled) {
				return false;
			}
			const autoTranslatePermission = reduxStore.getState().permissions['auto-translate'];
			const userRoles = reduxStore.getState().login?.user?.roles ?? [];
			return autoTranslatePermission?.some(role => userRoles.includes(role)) ?? false;
		} catch (e) {
			log(e);
			return false;
		}
	},
	getSenderName(sender) {
		const { UI_Use_Real_Name: useRealName } = reduxStore.getState().settings;
		return useRealName ? sender.name : sender.username;
	},
	getRoomTitle(room) {
		const { UI_Use_Real_Name: useRealName, UI_Allow_room_names_with_special_chars: allowSpecialChars } =
			reduxStore.getState().settings;
		const { username } = reduxStore.getState().login.user;
		if (RocketChat.isGroupChat(room) && !(room.name && room.name.length)) {
			return room.usernames
				.filter(u => u !== username)
				.sort((u1, u2) => u1.localeCompare(u2))
				.join(', ');
		}
		if (allowSpecialChars && room.t !== 'd') {
			return room.fname || room.name;
		}
		return ((room.prid || useRealName) && room.fname) || room.name;
	},
	getRoomAvatar(room) {
		if (RocketChat.isGroupChat(room)) {
			return room.uids?.length + room.usernames?.join();
		}
		return room.prid ? room.fname : room.name;
	}
};

export default RocketChat;
