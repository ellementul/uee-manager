const { 
  Member, 
  events: { change: changeMemberEvent } 
} = require('@ellementul/uee-core')

const { 
  events: { start: startEvent, time: timeEvent } 
} = require('@ellementul/uee-timeticker')

const createMemberEvent = require('../events/create_member_event')
const updateListEvent = require('../events/update_list_event')
const readyEvent = require('../events/all_members_ready_event')

class Manager extends Member {
  constructor({ roles }) {
    super()

    this.role = "Manager"

    if (!Array.isArray(roles) || roles.length < 1)
      throw new TypeError("The roles canot be empty!")

    if (
      roles.some(
        ({role, memberConstructor}) => typeof memberConstructor !==  "function"
      )
    ) throw TypeError("A member constructor isn't function!")

    this._roles = {
      [this.getRole()]: {
        memberConstructor: Manager,
        managers: new Map,
        statuses: new Map,
        instances: new Map([[this.uuid, this]])
      }
    }

    roles.forEach(({role, memberConstructor, local = false }) => { 
      this._roles[role] = { 
        local,
        memberConstructor,
        managers: new Map,
        statuses: new Map,
        instances: new Map
      }
    })

    this.onEvent(changeMemberEvent, payload => this.updateMembersStatus(payload))
    
    this._state = "Initialized"
  }

  updateMembersStatus ({ state, role, uuid }) {
    if(!this._roles[role])
      throw new TypeError(`Unknowed role: ${role}!`)

    this._roles[role].statuses.set(uuid, state)
  }

  sendMembersList ({ state }) {
    const roles = {}
    for (let role in this._roles) {
      roles[role] = {
        managers: Object.fromEntries(this._roles[role].managers),
        statuses: Object.fromEntries(this._roles[role].statuses)
      }
    }
    this.send(updateListEvent, {
      roles
    })
  }

  start(assistant = false) {
    if(!this._provider)
      throw new TypeError("The manger doesn't have provider!")

    this.isAssistantMode = !!assistant

    this.onEvent(updateListEvent, payload => {
      this.updateMembers(payload)
      if(!this.isAssistantMode) 
        this.checkMembers()
    })
    this.onEvent(createMemberEvent, payload => this.createMember(payload))
    this.onEvent(timeEvent, payload => this.sendMembersList(payload))
    
    if(!this.isAssistantMode) {
      if(this._roles.Ticker)
        this.createMember({ manager: this.uuid, role: "Ticker" })

      this.send(startEvent)
    }
  }

  updateMembers({ roles }) {
    for (let role in roles) {
      for (let uuid in roles[role].managers) {
        this._roles[role].managers.set(uuid, roles[role].managers[uuid])
      }
    }
  }

  checkMembers() {
    let taskToRun = []
    for (let role in this._roles) {
      taskToRun = taskToRun.concat(this.checkMember(role))
    }

    if(taskToRun.length > 0)
      taskToRun.forEach(task => this.send(createMemberEvent, task))
    else if(this._state == "Initialized") {
      this.send(readyEvent)
      this._state = "Ready"
    }
  }

  checkMember(role) {
    if(this._roles[role].local)
      return this.taskRunLocal({ role })
    else
      return this.checkSingleMember(role)
  }

  checkSingleMember(role) {
    if (this._roles[role].statuses.size === 0)
      return [{
        manager: this.uuid,
        role
      }]
    else
      return []
  }

  taskRunLocal({ role }) {
    const managers = this.getManagers()
    const existedMembersWithManagers = this.getExistsManagersForRole(role)

    const managersToRunMember = managers.filter( manager => {
      return !existedMembersWithManagers.includes(manager)
    })
    const tasksToRun = managersToRunMember.map(manager => {
      return {
        manager,
        role
      }
    })

    return tasksToRun
  }

  getManagers() {
    return [...this._roles[this.getRole()].statuses.keys()]
  }
  getExistsManagersForRole(role) {
    return [...this._roles[role].managers.values()]
  }

  createMember({ manager, role }) {
    if(manager != this.uuid) return

    const isInstance = [...this._roles[role].managers.values()]
      .some(currentManager => currentManager === manager)
    if (isInstance) return

    if(!this._roles[role])
      throw new TypeError(`Unknowed role: ${role}!`)

    const memberConstructor = this._roles[role].memberConstructor
    const member = new memberConstructor
    member.role = role
    member.setProvider(this._provider)
    this._roles[role].instances.set(member.uuid, member)
    this._roles[role].managers.set(member.uuid, this.uuid)
  }

  reset() {
    for (let role in this._roles) {
      if (role !== this.getRole())
        for (let [uuid, instance] of this._roles[role].instances) {
          if(typeof instance.reset == "function")
            instance.reset()
        }
    }
  }
}

module.exports = { Manager }